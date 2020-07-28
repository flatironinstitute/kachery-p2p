import dgram from 'dgram';
import { JSONStringifyDeterministic, verifySignature, hexToPublicKey, getSignature } from './common/crypto_util.js'
import { log } from './common/log.js';
import { randomAlphaString, sleepMsec } from './common/util.js';
import { request } from 'http';
import { rejects } from 'assert';

class UdpConnectionManager {
    constructor({nodeId, keyPair, protocolVersion}) {
        this._nodeId = nodeId;
        this._keyPair = keyPair;
        this._protocolVersion = protocolVersion;

        this._socket = null;
        this._incomingConnections = {}; // by connection id
        this._outgoingConnections = {}; // by connection id
        this._pendingOutgoingConnections = {}; // by connection id

        this._onIncomingConnectionCallbacks = [];

        // to: move elsewhere
        this._swarmNodes = {};
        this._onLocateSwarmNodesResponseCallbacks = [];
        
    }
    onIncomingConnection = (cb) => {
        this._onIncomingConnectionCallbacks.push(cb);
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
    // todo: move this
    onLocateSwarmNodesResponse(cb) {
        this._onLocateSwarmNodesResponseCallbacks.push(cb);
    }
    createOutgoingConnection({remoteAddress, remotePort}) {
        const C = new UdpConnection(this, {remoteAddress, remotePort, incoming: false});
        C.sendMessage({
            type: 'openConnection',
            connectionId: C._connectionId,
            protocolVersion: this._protocolVersion,
            nodeId: this._nodeId
        });
        this._pendingOutgoingConnections[C._connectionId]  = C;
        return C;
    }
    async _handleMessage(fromNodeId, remote, message, connectionId) {
        if (message.type === 'openConnection') {
            if (message.protocolVersion !== this._protocolVersion) {
                log().warning('Udp openConnection: Mismatch protocol version');
                return;
            }
            if (!message.connectionId) {
                log().warning('Udp openConnection: No connection ID');
                return;
            }
            if (message.connectionId in this._incomingConnections) {
                log().warning('Udp openConnection: Incoming connection with ID already exists', {connectionId: message.connectionId});
                return;
            }
            // wants to open a new connection
            const connection = new UdpConnection(this, {remoteAddress: remote.address, remotePort: remote.port, connectionId: message.connectionId, incoming: true});
            connection._remoteNodeId = fromNodeId;
            connection.onDisconnect(() => {
                if (connection.connectionId() in this._incomingConnections) {
                    delete this._incomingConnections[connection.connectionId()];
                }
            });
            this._incomingConnections[connection.connectionId()] = connection;
            this._sendMessageToRemote(remote, {
                type: 'connectionOpened',
                connectionId: message.connectionId,
                endpoint: remote,
                nodeId: this._nodeId
            }, {connectionId: null});
            this._onIncomingConnectionCallbacks.forEach(cb => {
                cb(connection);
            });
            connection._triggerConnect();
        }
        else if (message.type === 'connectionOpened') {
            if (!message.connectionId) {
                log().warning('Udp connectionOpened: No connectionId');
                return;
            }
            const connectionId = message.connectionId;
            if (!(connectionId in this._pendingOutgoingConnections)) {
                log().warning('Udp connectionOpened: connetion ID not in pending outgoing connections');
                return;
            }
            const C = this._pendingOutgoingConnections[connectionId];
            delete this._pendingOutgoingConnections[connectionId];
            C._remoteNodeId = fromNodeId;
            C._endpoint = message.endpoint;
            C._remoteNodeId = message.remoteNodeId;
            this._outgoingConnections[connectionId] = C;
            C.onDisconnect(() => {
                if (C.connectionId() in this._outgoingConnections) {
                    delete this._outgoingConnections[C.connectionId()];
                }
            });
            C._triggerConnect();
        }
        // todo: move
        else if (message.type === 'announceSwarmNode') {
            if ((!remote.address) || (!remote.port)) {
                log().warning('announceSwarmNode: no remote.address or remote.port', {remote});
                return;
            }
            if (!message.swarmName) {
                log().warning('announceSwarmNode: no remote.swarmName', {message});
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
            this._swarmNodes[swarmName][fromNodeId] = {
                timestamp: new Date() - 0,
                nodeInfo
            };
            return;
        }
        // todo: move
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
            const x = this._swarmNodes[message.swarmName] || {};
            const nodeInfos = {};
            for (let nodeId in x) {
                const elapsed = (new Date()) - x[nodeId].timestamp;
                if (elapsed < 60000) {
                    nodeInfos[nodeId] = x[nodeId].nodeInfo;
                }
                else {
                    delete x[nodeId];
                }
            }
            this._sendMessageToRemote(remote, {
                type: 'locateSwarmNodesResponse',
                swarmName: message.swarmName,
                nodeInfos
            }, {connectionId: null});
            return;
        }
        // todo: move
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
        else {
            if (!connectionId) {
                console.warn(message);
                log().warning('No connectionId in incoming udp message', {remote});
                return;
            }
            if (connectionId in this._pendingOutgoingConnections) {
                log().warning('Got message for connection that is still pending', {remote, connectionId});
                return;
            }
            const con = this._incomingConnections[connectionId] || this._outgoingConnections[connectionId];
            if (!con) {
                log().warning('No open udp connection with id', {remote, connectionId});
                return;
            }
            
            if (fromNodeId !== con.remoteNodeId()) {
                // this is important, so we don't get fake messages from other nodes
                log().warning('Yikes. fromNodeId does not match for udp message connection', {remote, connectionId, fromNodeId, expectedFromNodeId: con.remoteNodeId()});
                return;
            }
            con._handleMessageFromClient(message);
        }
    }
    _sendMessageToRemote(remote, message, {connectionId}) {
        const body = {
            fromNodeId: this._nodeId,
            message
        };
        if (connectionId) {
            body.connectionId = connectionId;
        }
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
    async _start() {
        while (true) {
            //

            await sleepMsec(1000);
        }
    }
}

class UdpConnection {
    constructor(udpConnectionManager, {remoteAddress, remotePort, connectionId, incoming}) {
        this._udpConnectionManager = udpConnectionManager;
        this._connectionId = connectionId || randomAlphaString(10) + '-udp';
        this._incoming = incoming;
        this._remoteNodeId = null;
        this._remote = {address: remoteAddress, port: remotePort};
        this._onMessageCallbacks = [];
        this._onConnectCallbacks = [];
        this._onDisconnectCallbacks = [];
        this._onErrorCallbacks = [];
        this._connected = false;
        this._endpoing = null;
    }
    endpoint() {
        return this._endpoint;
    }
    connectionId() {
        return this._connectionId;
    }
    remoteNodeId() {
        return this._remoteNodeId;
    }
    onMessage(cb) {
        this._onMessageCallbacks.push(cb);
    }
    onError(cb) {
        this._onErrorCallbacks.push(cb);
    }
    onConnect(cb) {
        if (this._connected) {
            cb();
        }
        this._onConnectCallbacks.push(cb);
    }
    onDisconnect(cb) {
        this._onDisconnectCallbacks.push(cb);
    }
    sendMessage(msg) {
        this._udpConnectionManager._sendMessageToRemote(this._remote, msg, {connectionId: this._connectionId});
    }
    disconnect() {
        // note: this will trigger deleting the connection from the list of open connections in the udpConnectionManager
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
    _triggerConnect() {
        if (this._connected) return;
        this._connected = true;
        this._onConnectCallbacks.forEach(cb => cb());
    }
}

export default UdpConnectionManager;