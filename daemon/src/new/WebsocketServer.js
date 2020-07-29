import WebSocket from 'ws';
import { JSONStringifyDeterministic, verifySignature, hexToPublicKey, getSignature } from '../common/crypto_util.js'
import { protocolVersion } from './protocolVersion.js';
import dgram from 'dgram';
import { randomAlphaString } from '../common/util.js';

class WebsocketServer {
    constructor({nodeId, keyPair, useUdp=false}) {
        this._nodeId = nodeId;
        this._keyPair = keyPair;
        this._useUdp = useUdp;
        this._websocketServer = null; // or udpServer
        this._onIncomingConnectionCallbacks = [];
    }
    onIncomingConnection = (cb) => {
        this._onIncomingConnectionCallbacks.push(cb);
    }
    async listen(port) {
        ///////////////////////////////////////////////////////////////////////////////
        if (!this._useUdp) {
            this._websocketServer = new WebSocket.Server({ port });
        }
        else {
            this._websocketServer = new UdpServer({ port });
        }
        this._websocketServer.on('connection', (ws) => {
            let X = new IncomingWebsocketConnection(ws, {nodeId: this._nodeId, keyPair: this._keyPair});
            X.onInitialized(() => {
                this._onIncomingConnectionCallbacks.forEach(cb => {
                    cb(X);
                });
            });
        });
        ///////////////////////////////////////////////////////////////////////////////
    }
    async createOutgoingWebsocketConnection({address, port, remoteNodeId}) {
        return new Promise((resolve, reject) => {
            let finished = false;
            const X = new OutgoingWebsocketConnection({
                address,
                port,
                nodeId: this._nodeId,
                keyPair: this._keyPair,
                remoteNodeId,
                useUdp: this._useUdp,
                udpServer: this._useUdp ? this._websocketServer : null
            });
            X.onConnect(() => {
                if (finished) return;
                finished = true;
                resolve(X);
            });
            X.onError((errorString) => {
                if (finished) return;
                finished = true;
                reject(new Error(errorString));
            });
            X.onDisconnect(() => {
                if (finished) return;
                finished = true;
                reject(new Error('Outgoing connection disconnected.'));
            });
        });
    }
}

class IncomingWebsocketConnection {
    constructor(webSocket, {nodeId, keyPair}) {
        this._nodeId = nodeId;
        this._keyPair = keyPair;
        this._webSocket = webSocket;
        this._onMessageCallbacks = [];
        this._onDisconnectCallbacks = [];
        this._onInitializedCallbacks = [];
        this._remoteNodeId = null;
        this._initialized = false;

        this._webSocket.on('close', () => {
            this._onDisconnectCallbacks.forEach(cb => cb());
        })

        this._webSocket.on('error', () => {
            // this is important so we don't throw an exception
            // question: do we need to do something here? will 'close' be called also?
        });

        this._webSocket.on('message', (message) => {
            const msg = JSON.parse(message);
            const body = msg.body;
            const signature = msg.signature;
            if (!body.message) {
                this._webSocket.close();
                return;
            }
            if (!this._initialized) {
                if (!body.fromNodeId) {
                    this._webSocket.close();
                    return;
                }
                if (body.message.type !== 'initial') {
                    this._webSocket.close();
                    return;
                }
                if (body.message.protocolVersion !== protocolVersion()) {
                    this._webSocket.close();
                    return;
                }
                if (!verifySignature(body, signature, hexToPublicKey(body.fromNodeId))) {
                    this._webSocket.close();
                    return;
                }
                this._remoteNodeId = body.fromNodeId;
                this._initialized = true;
                this._onInitializedCallbacks.forEach(cb => cb());
                this.sendMessage({type: 'accepted'});
                return;
            }
            
            if (body.fromNodeId !== this._remoteNodeId) {
                this._webSocket.close();
                return;
            }
            if (!verifySignature(body, signature, hexToPublicKey(this._remoteNodeId))) {
                this._webSocket.close();
                return;
            }
            this._onMessageCallbacks.forEach(cb => {
                cb(msg.body.message);
            });
        });
    }
    onInitialized(cb) {
        this._onInitializedCallbacks.push(cb);
    }
    remoteNodeId() {
        return this._remoteNodeId;
    }
    onMessage(cb) {
        this._onMessageCallbacks.push(cb);
    }
    onDisconnect(cb) {
        this._onDisconnectCallbacks.push(cb);
    }
    sendMessage(msg) {
        const body = {
            fromNodeId: this._nodeId,
            message: msg
        }
        const message = {
            body,
            signature: getSignature(body, this._keyPair)
        };
        this._webSocket.send(JSONStringifyDeterministic(message));
    }
    disconnect() {
        this._webSocket.close();
    }
}

class OutgoingWebsocketConnection {
    constructor({ address, port, nodeId, keyPair, remoteNodeId, useUdp=false, udpServer=null }) {
        this._nodeId = nodeId;
        this._keyPair = keyPair;
        this._remoteNodeId = remoteNodeId;
        this._useUdp = useUdp;
        this._address = address;
        this._port = port;
        this._queuedMessages = [];
        this._onMessageCallbacks = [];
        this._onConnectCallbacks = [];
        this._onErrorCallbacks = [];
        this._onDisconnectCallbacks = [];
        this._isOpen = false;
        this._isClosed = false;
        this._accepted = false;
        if (!this._useUdp) {
            this._ws = new WebSocket(`ws://${this._address}:${this._port}`);
        }
        else {
            this._ws = udpServer._createOutgoingUdpConnection({address: this._address, port: this._port});
        }

        this._ws.on('open', () => {
            if (this._isOpen) return;
            this._isOpen = true;
            this._sendQueuedMessages();
        });

        this._ws.on('close', () => {
            if (this._isClosed) return;
            this._isClosed = true;
            this._onDisconnectCallbacks.forEach(cb => cb());
        });

        this._ws.on('error', () => {
            this._onErrorCallbacks.forEach(cb => cb());
            // this is important so we don't throw an exception
            // question: do we need to do something here? will 'close' be called also?
        });

        this._ws.on('message', msg => {
            const message = JSON.parse(msg);
            const body = message.body;
            const signature = message.signature;
            if ((!body) || (!signature)) {
                this.disconnect();
                return;
            }
            const message2 = message.body.message;
            const fromNodeId = message.body.fromNodeId;
            if (!message2) {
                this.disconnect();
                return;
            }
            if (this._remoteNodeId) {
                if (fromNodeId !== this._remoteNodeId) {
                    this.disconnect();
                    return;
                }
            }
            else {
                this._remoteNodeId = fromNodeId;
            }            this._
            if (!verifySignature(body, signature, hexToPublicKey(fromNodeId))) {
                this.disconnect();
                return;
            }
            if (!this._accepted) {
                if (message2.type === 'accepted') {
                    this._accepted = true;
                    this._onConnectCallbacks.forEach(cb => cb());
                    return;
                }
            }
            this._onMessageCallbacks.forEach(cb => {
                cb(message2);
            });
        });
        this.sendMessage({
            type: 'initial',
            protocolVersion: protocolVersion()
        });
    }
    remoteNodeId() {
        return this._remoteNodeId;
    }
    disconnect() {
        this._ws.close();
    }
    onConnect(cb) {
        this._onConnectCallbacks.push(cb);
    }
    onError(cb) {
        this._onErrorCallbacks.push(cb);
    }
    onMessage(cb) {
        this._onMessageCallbacks.push(cb);
    }
    onDisconnect(cb) {
        this._onDisconnectCallbacks.push(cb);
    }
    sendMessage(msg) {
        if (this._isOpen) {
            if (this._isClosed) {
                // log().warning('Cannot send message. Websocket is closed.', {address: this._address, port: this._port});
                return;
            }
            const body = {
                fromNodeId: this._nodeId,
                message: msg
            };
            const message = {
                body,
                signature: getSignature(body, this._keyPair)
            };
            this._ws.send(JSONStringifyDeterministic(message));
        }
        else {
            this._queuedMessages.push(msg);
        }
    }
    _sendQueuedMessages() {
        const qm = this._queuedMessages;
        this._queuedMessages = [];
        qm.forEach(msg => {
            this.sendMessage(msg);
        });
    }
}

class UdpServer {
    constructor(port) {
        this._onConnectCallbacks = [];
        this._incomingConnections = {}; // by connection id
        this._outgoingConnections = {}; // by connection id
        this._pendingOutgoingConnections = {}; // by connection id
        this._queuedMessages = [];
        
        const socket = dgram.createSocket('udp4');
        socket.bind(port, '');
        socket.on('message', (messageTxt, remote) => {
            let msg;
            try {
                msg = JSON.parse(messageTxt);
            }
            catch {
                console.warn('Unable to parse udp message', {remote});
                return;
            }
            if ((message.type === 'openConnection') && (isValidConnectionId(message.connectionId))) {
                if (!(message.connectionId in this._incomingConnections)) {
                    this._incomingConnections[message.connectionId] = new UdpConnection({
                        udpServer,
                        connectionId: message.connectionId,
                        remoteAddress: remote.address,
                        remotePort: remote.port
                    });
                    const acceptMessage = {type: 'acceptConnection', connectionId: message.connectionId};
                    _udpSocketSend(this._socket, acceptMessage, remote.port, remote.address);
                    this._incomingConnections[message.connectionId]._setOpen();
                }
            }
            else if ((message.type === 'acceptConnection') && (isValidConnectionId(message.connectionId))) {
                if (message.connectionId in this._pendingOutgoingConnections) {
                    this._outgoingConnections[message.connectionId] = this._pendingOutgoingConnections[message.connectionId];
                    delete this._pendingOutgoingConnections[message.connectionId];
                    this._outgoingConnections[message.connectionId]._setOpen();
                }
            }
            else if (msg.connectionId) {
                if (msg.connectionId in this._incomingConnections) {
                    this._incomingConnections[msg.connectionId]._handleIncomingMessage(msg.message);
                }
                else if (msg.connectionId in this._outgoingConnections) {
                    this._outgoingConnections[msg.connectionId]._handleIncomingMessage(msg.message);
                }
            }
            else {
                // don't do anything
            }
        });
        this._socket = socket;
    }
    on(name, cb) {
        if (name === 'connection')
            this._onConnectionCallbacks.push(cb);
    }
    _createOutgoingUdpConnection({address, port}) {
        const connectionId = randomAlphaString(10);
        this._pendingOutgoingConnections[connectionId] = new UdpConnection({udpServer: this, connectionId, remoteAddress: address, remotePort: port});
        const openMessage = {
            type: 'openConnection',
            connectionId
        };
        _udpSocketSend(this._socket, openMessage, port, address);
    }
}

class UdpConnection {
    constructor({udpServer, connectionId, remoteAddress, remotePort}) {
        this._udpServer = udpServer;
        this._connectionId = connectionId;
        this._remoteAddress = remoteAddress;
        this._remotePort = remotePort;
        this._open = false;
        this._closed = false;

        this._onOpenCallbacks = [];
        this._onCloseCallbacks = [];
        this._onErrorCallbacks = [];
        this._onMessageCallbacks = [];
    }
    on(name, cb) {
        if (name === 'open') {
            if (this._open) cb();
            this._onOpenCallbacks.push(cb);
        }
        else if (name === 'close') {
            this._onCloseCallbacks.push(cb);
        }
        else if (name === 'error') {
            this._onErrorCallbacks.push(cb);
        }
        else if (name === 'message') {
            this._onMessageCallbacks.push(cb);
        }
    }
    send(message) {
        if (this._closed) return;
        if (!this._open) {
            this._queuedMessages.push(message);
            return;
        }
        const message2 = {
            connectionId: this._connectionId,
            message
        };
        _udpSocketSend(this._udpServer._socket, message2, this._remotePort, this._remoteAddress);
    }
    close() {
        if (this._closed) return;
        this._closed = true;
        this._open = false;
        this._onCloseCallbacks.forEach(cb => cb());
    }
    _handleIncomingMessage(message) {
        if (this._closed) return;
        this._onMessageCallbacks.forEach(cb => cb(message));
    }
    _setOpen() {
        if (this._open) return;
        if (this._closed) return;
        this._open = true;
        this._onOpenCallbacks.forEach(cb => cb());
        const qm = this._queuedMessages;
        this._queuedMessages = [];
        for (let m of qm) {
            this._sendMessage(m);
        }
    }

}

function _udpSocketSend(socket, message, port, address) {
    const messageText = JSONStringifyDeterministic(message);
    socket.send(messageText, port, address, (err, numBytesSent) => {
        if (err) {
            console.warn('Failed to send udp message to remote', {address, port, error: err.message});
            return;
        }
        if (numBytesSent !== messageText.length) {
            console.warn('Problem sending udp message to remote: numBytesSent does not equal expected');
            return;
        }
    });
}

function isValidConnectionId(x) {
    if (!x) return false;
    if (typeof(x) !== 'string') return false;
    if (x.length < 10) return false;
    if (x.length > 20) return false;
    return true;
}

export default WebsocketServer;