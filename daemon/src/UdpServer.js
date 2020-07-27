import dgram from 'dgram';
import { JSONStringifyDeterministic, verifySignature, hexToPublicKey, getSignature } from './common/crypto_util.js'
import { log } from './common/log.js';
import { randomAlphaString, sleepMsec } from './common/util.js';
import { request } from 'http';

class UdpServer {
    constructor({nodeId, keyPair}) {
        this._nodeId = nodeId;
        this._keyPair = keyPair;
        this._onConnectionCallbacks = [];
        this._socket = null;
        this._openConnections = {}; // by connection id
        this._publicEndpoint = null;
        this._swarmNodes = {};
        this._onLocateSwarmNodesResponseCallbacks = [];
        this._clientCode = randomAlphaString(10); // so we can verify that the remote endpoint is coming from a place where we requested it from
    }
    onConnection = (cb) => {
        this._onConnectionCallbacks.push(cb);
    }
    publicEndpoint() {
        return this._publicEndpoint;
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
            const { body, signature } = msg;
            const fromNodeId = body.fromNodeId;
            const message = body.message;
            const connectionId = body.connectionId || null;
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
            this._handleMessage(fromNodeId, remote, message, connectionId);
        });
        this._socket = socket;
        this._start();
    }
    onLocateSwarmNodesResponse(cb) {
        this._onLocateSwarmNodesResponseCallbacks.push(cb);
    }
    async _handleMessage(fromNodeId, remote, message, connectionId) {
        if (message.type === 'whatsMyPublicEndpoint') {
            // No connection, just provide a response
            // the client wants to know their public endpoint for purpose of holepunching
            if ((!remote.address) || (!remote.port)) {
                log().warning('whatsMyPublicEndpoint message: no remote.address or remote.port', {remote});
                return;
            }
            if (!message.clientCode) {
                log().warning('whatsMyPublicEndpoint message: no remote.clientCode');
                return;
            }
            log().debug('Handling whatsMyPublicEndpoint message', {fromNodeId, remote});
            this._sendMessageToRemote(remote, {
                type: 'whatsMyPublicEndpointResponse',
                publicEndpoint: {
                    address: remote.address,
                    port: remote.port
                },
                clientCode: message.clientCode
            });
            return;
        }
        else if (message.type === 'whatsMyPublicEndpointResponse') {
            if (message.clientCode !== this._clientCode) {
                log().warning('whatsMyPublicEndpointReponse message: incorrect client code', {messageClientCode: message.clientCode, clientCode: this._clientCode});
                return;
            }
            if (this._publicEndpoint) {
                log().warning('whatsMyPublicEndpointReponse message: already have the public endpoint');
                return;
            }
            log().debug('Handling whatsMyPublicEndpointResponse message', {message});
            this._publicEndpoint = message.publicEndpoint;
            // todo: verify the correctness of the endpoint
        }
        else if (message.type === 'announceSwarmNode') {
            if ((!remote.address) || (!remote.port)) {
                log().warning('announceSwarmNode: no remote.address or remote.port', {remote});
                return;
            }
            if (!message.swarmName) {
                log().warning('announceSwarmNode: no remote.swarmName');
                return;
            }
            if (!message.nodeInfo) {
                log().warning('announceSwarmNode: no remote.nodeInfo');
                return;
            }
            log().debug('Handling announceSwarmNode message', {fromNodeId, remote, message});
            const swarmName = message.swarmName;
            if (!(swarmName in this._swarmNodes))
                this._swarmNodes[swarmName] = {};
            const nodeInfo = message.nodeInfo;
            nodeInfo.udpAddress = remote.address;
            nodeInfo.udpPort = remote.port;
            this._swarmNodes[swarmName][fromNodeId] = nodeInfo;
            return;
        }
        else if (message.type === 'locateSwarmNodes') {
            if ((!remote.address) || (!remote.port)) {
                log().warning('locateSwarmNodes: no remote.address or remote.port', {remote});
                return;
            }
            if (!message.swarmName) {
                log().warning('locateSwarmNodes: no remote.swarmName');
                return;
            }
            log().debug('Handling locateSwarmNodes message', {fromNodeId, remote, message});
            const nodeInfos = this._swarmNodes[message.swarmName] || {};
            this._sendMessageToRemote(remote, {
                type: 'locateSwarmNodesResponse',
                swarmName: message.swarmName,
                nodeInfos
            });
            return;
        }
        else if (message.type === 'locateSwarmNodesResponse') {
            if (!message.swarmName) {
                log().warning('locateSwarmNodesResponse: no remote.swarmName');
                return;
            }
            if (!message.nodeInfos) {
                log().warning('locateSwarmNodesResponse: no remote.nodeInfos');
                return;
            }
            this._onLocateSwarmNodesResponseCallbacks.forEach(cb => {
                cb({swarmName: message.swarmName, nodeInfos: message.nodeInfos});
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
            this._sendMessageToRemote(remote, {
                type: 'connectionOpened',
                connectionId: connection.connectionId()
            });
            this._onConnectionCallbacks.forEach(cb => {
                cb(connection, message.initialInfo);
            });
        }
        else {
            if (!connectionId) {
                console.warn(message);
                log().warning('No connectionId in incoming udp message', {remote});
                return;
            }
            if (!(connectionId in this._openConnections)) {
                log().warning('No open udp connection with id', {remote, connectionId});
                return;
            }
            const con = this._openConnections[connectionId];
            if (fromNodeId !== con.fromNodeId()) {
                // this is important, so we don't get fake messages from other nodes
                log().warning('Yikes. fromNodeId does not match for udp message connection', {remote, connectionId, fromNodeId, expectedFromNodeId: con.fromNodeId()});
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
            signature: getSignature(body, this._keyPair)
        }
        const signedMessageTxt = JSONStringifyDeterministic(signedMessage);
        this._socket.send(signedMessageTxt, remote.port, remote.address, (err, numBytesSent) => {
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
    async _startCheckingForPublicEndpoint() {
        while (true) {
            if (!this._publicEndpoint) {
                // const rendezvousServerInfo = {
                //     address: '52.9.11.30', // aws
                //     port: 44501
                // };
                const rendezvousServerInfo = {
                    address: 'localhost',
                    port: 3008
                };
                const msg = {
                    type: 'whatsMyPublicEndpoint',
                    clientCode: this._clientCode
                }
                log().debug('Sending whatsMyPublicEndpoint message to rendezvous server', {rendezvousServerInfo});
                this._sendMessageToRemote(rendezvousServerInfo, msg);
            }

            await sleepMsec(10000);
        }
    }
    async _start() {
        // this._startCheckingForPublicEndpoint();
        while (true) {
            //

            await sleepMsec(1000);
        }
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