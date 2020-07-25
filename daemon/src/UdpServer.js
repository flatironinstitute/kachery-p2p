import dgram from 'dgram';
import { JSONStringifyDeterministic, verifySignature, hexToPublicKey, getSignature } from './common/crypto_util.js'
import { log } from './common/log.js';
import { randomAlphaString } from './common/util.js';

class UdpServer {
    constructor({nodeId, keyPair}) {
        this._nodeId = nodeId;
        this._keyPair = keyPair;
        this._onConnectionCallbacks = [];
        this._socket = null;
        this._openConnections = {}; // by connection id
    }
    onConnection = (cb) => {
        this._onConnectionCallbacks.push(cb);
    }
    async listen(port) {
        ///////////////////////////////////////////////////////////////////////////////
        // Based on http://www.bford.info/pub/net/p2pnat/index.html
        // And Thanks: https://github.com/SamDecrock/node-udp-hole-punching

        const socket = dgram.createSocket('udp4');
        socket.bind(port, '');
        socket.on('message', (messageTxt, remote) => {
            let msg;
            try {
                msg = JSON.parse(messageTxt);
            }
            catch {
                log().warning('Unable to parse udp message', {remote});
                return;
            }
            if ((!msg.body) || (!msg.signature)) {
                log().warning('Improper udp message', {remote});
                return;
            }
            const { body, signature } = message;
            const fromNodeId = body.fromNodeId;
            const message = body.message;
            if (!fromNodeId) {
                log().warning('No body.fromNodeId in udp message', {remote});
                return;
            }
            if (!message) {
                log().warning('No body.message in udp message', {remote});
                return;
            }
            if (!verifySignature(body, signature, hexToPublicKey(fromNodeId))) {
                log().warning('Unable to verify signature in udp message', {remote});
                return;
            }
            this._handleMessage(fromNodeId, remote, message);
        });
        this._socket = socket;
    }
    async _handleMessage(fromNodeId, remote, message) {
        if (message.type === 'whatsMyPublicEndpoint') {
            // No connection, just provide a response
            // the client wants to know their public endpoint for purpose of holepunching
            if ((!remote.address) || (!remote.port)) {
                log().warning('whatsMyPublicEndpoint message: no remote.address or remote.port', {remote});
                return;
            }
            this._sendMessageToRemote(remote, {
                type: 'whatsMyPublicEndpointResponse',
                publicAddress: remote.address,
                publicPort: remote.port
            });
            return;
        }
        else if (message.type === 'openConnection') {
            // wants to open a new connection
            const connection = new UdpServerConnection(this, {fromNodeId, remote});
            connection.onDisconnect(() => {
                if (connection.connectionId() in this._openConnections) {
                    delete this._openConnections[connection.connectionId()];
                }
            });
            this._openConnections[connection.connectionId()] = connection;
            this._sendMessageToRemote({
                type: 'connectionOpened',
                connectionId: connection.connectionId()
            });
            this._onConnectionCallbacks.forEach(cb => {
                cb(connection, message.initialInfo);
            });
        }
        else {
            if (!message.connectionId) {
                log().warning('No connectionId in incoming udp message', {remote});
                return;
            }
            if (!(message.connectionId in this._openConnections)) {
                log().warning('No open udp connection with id', {remote, connectionId: message.connectionId});
                return;
            }
            const con = this._openConnections[message.connectionId];
            if (fromNodeId !== con.fromNodeId()) {
                // this is important, so we don't get fake messages from other nodes
                log().warning('Yikes. fromNodeId does not match for udp message connection', {remote, connectionId: message.connectionId, fromNodeId, expectedFromNodeId: con.fromNodeId()});
                return;
            }
            con._handleMessageFromClient(message);
        }
    }
    _sendMessageToRemote(remote, message) {
        const body = {
            fromNodeId: this._nodeId,
            message
        };
        const signedMessage = {
            body,
            signature: getSignature(responseBody, this._keyPair)
        }
        const signedMessageTxt = JSONStringifyDeterministic(signedMessage);
        socket.send(signedMessageTxt, remote.port, remote.address, (err, numBytesSent) => {
            if (err) {
                log.warning('Failed to send udp message to remote', {remote, messageType: message.type, error: err.message});
                return;
            }
            if (numBytesSent !== signedMessageTxt.length) {
                log.warning('Problem sending udp message to remote: numBytesSent does not equal expected', {remote, numBytesSent, messageLenth: signedMessageTxt.length});
                return;
            }
        });
    }
}

class UdpServerConnection {
    constructor(udpServer, {fromNodeId, remote}) {
        this._connectionId = randomAlphaString(10);
        this._udpServer = udpServer;
        this._fromNodeId = fromNodeId;
        this._remote = remote;
        this._onMessageCallbacks = [];
        this._onDisconnectCallbacks = [];
    }
    connectionId() {
        return this._connectionId;
    }
    fromNodeId() {
        return this._fromNodeId;
    }
    onMessage(cb) {
        this._onMessageCallbacks.push(cb);
    }
    onDisconnect(cb) {
        this._onDisconnectCallbacks.push(cb);
    }
    sendMessage(msg) {
        this._udpServer._sendMessageToRemote(this._remote, msg);
    }
    disconnect() {
        // note: this will trigger deleting the connection from the list of open connections in the udpServer
        this._onDisconnectCallbacks.forEach(cb => cb());
    }
    _handleMessageFromClient(message) {
        if (message.type === 'closeConnection') {
            this.disconnect();
            return;
        }
        this._onMessageCallbacks.forEach(cb => {
            cb(message);
        });
    }
}

export default UdpServer;