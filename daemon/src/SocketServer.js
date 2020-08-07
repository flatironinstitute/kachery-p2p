import assert from 'assert';
import WebSocket from 'ws';
import { JSONStringifyDeterministic, verifySignature, hexToPublicKey, getSignature } from './common/crypto_util.js'
import { protocolVersion } from './protocolVersion.js';
import InternalUdpServer from './InternalUdpServer.js';
import ip from 'ip';
import { validateObject, validateNodeToNodeMessage, validateNodeId } from './schema/index.js';

// todo: monitor and clean up closed connections throughout file

class SocketServer {
    constructor({nodeId, keyPair, useUdp=false, onListen}) {
        this._nodeId = nodeId;
        this._keyPair = keyPair;
        this._useUdp = useUdp;
        this._onListen = onListen;
        this._websocketServerOrInternalUdpServer = null; // or InternaludpServer
        this._onIncomingConnectionCallbacks = [];
        this._udpPublicEndpointChangedCallbacks = [];
    }
    onIncomingConnection = (cb) => {
        this._onIncomingConnectionCallbacks.push(cb);
    }
    async listen(port) {
        ///////////////////////////////////////////////////////////////////////////////
        if (!this._useUdp) {
            this._websocketServerOrInternalUdpServer = new WebSocket.Server({ port });
            this._websocketServerOrInternalUdpServer.on('listening', () => {
                this._onListen && this._onListen();
            });
        }
        else {
            this._websocketServerOrInternalUdpServer = new InternalUdpServer({ port });
            this._websocketServerOrInternalUdpServer.onPublicEndpointChanged(() => {
                this._udpPublicEndpointChangedCallbacks.forEach(cb => cb());
            })
        }
        this._websocketServerOrInternalUdpServer.on('connection', (ws) => {
            let X = new IncomingConnection(ws, {nodeId: this._nodeId, keyPair: this._keyPair});
            X.onInitialized(() => {
                this._onIncomingConnectionCallbacks.forEach(cb => {
                    cb(X);
                });
            });
        });
        ///////////////////////////////////////////////////////////////////////////////
    }
    udpPublicEndpoint() {
        if (!this._useUdp) return null;
        if (this._websocketServerOrInternalUdpServer) {
            return this._websocketServerOrInternalUdpServer.publicEndpoint();
        }
        else {
            return null;
        }
    }
    onUdpPublicEndpointChanged(cb) {
        // assert(typeof(cb) === 'function');

        this._udpPublicEndpointChangedCallbacks.push(cb);
    }
    listenAddress() {
        return ip.address();
    }
    listenPort() {
        return this._websocketServerOrInternalUdpServer ? this._websocketServerOrInternalUdpServer.address().port : null;
    }
    async createOutgoingConnection({address, port, remoteNodeId}) {
        validateObject(address, '/Address');
        validateObject(port, '/Port');
        if (remoteNodeId !== null) {
            validateNodeId(remoteNodeId);
        }

        return new Promise((resolve, reject) => {
            let finished = false;
            const X = new OutgoingConnection({
                address,
                port,
                nodeId: this._nodeId,
                keyPair: this._keyPair,
                remoteNodeId,
                useUdp: this._useUdp,
                udpServer: this._useUdp ? this._websocketServerOrInternalUdpServer : null
            });
            X.onConnect(() => {
                if (finished) return;
                finished = true;
                resolve(X);
            });
            X.onError((error) => {
                if (finished) return;
                finished = true;
                reject(error);
            });
            X.onDisconnect(() => {
                if (finished) return;
                finished = true;
                reject(new Error('Outgoing connection disconnected.'));
            });
        });
    }
}

class IncomingConnection {
    constructor(webSocket, {nodeId, keyPair}) {
        this._nodeId = nodeId;
        this._keyPair = keyPair;
        this._webSocket = webSocket;
        this._onMessageCallbacks = [];
        this._onDisconnectCallbacks = [];
        this._onInitializedCallbacks = [];
        this._remoteNodeId = null;
        this._initialized = false;
        this._disconnecting = false;

        this._webSocket.on('close', () => {
            this._onDisconnectCallbacks.forEach(cb => cb());
        })

        this._webSocket.on('error', () => {
            // this is important so we don't throw an exception
            // question: do we need to do something here? will 'close' be called also?
        });

        this._webSocket.on('message', (messageText) => {
            let messageParsed;
            try {
                messageParsed = JSON.parse(messageText);
            }
            catch(err) {
                this._webSocket.close();
                return;
            }
            if (messageParsed.type === 'error') {
                console.warn(`Socket message error: ${messageParsed.error}`);
                this._webSocket.close();
                return;
            }
            if (!validateObject(messageParsed, '/RawSocketMessage', {noThrow: true})) {
                this.disconnect();
                return;
            }
            const {body, signature} = messageParsed;
            validateNodeId(body.fromNodeId);
            validateObject(body.message, '/SocketMessage');
            if (!verifySignature(body, signature, hexToPublicKey(body.fromNodeId), {checkTimestamp: true})) {
                this._webSocket.close();
                return;
            }            
            if (!this._initialized) {
                if (body.fromNodeId === this._nodeId) {
                    this.sendMessage({type: 'error', error: `Cannot connect to self.`});
                    this.disconnectLater();
                    return;
                }
                if (body.message.type !== 'initial') {
                    this.sendMessage({type: 'error', error: 'Message type was expected to be initial.'});
                    this.disconnectLater();
                    return;
                }
                if (body.message.protocolVersion !== protocolVersion()) {
                    // console.warn(`IncomingSocketConnection: incorrect protocol version ${body.message.protocolVersion} <> ${protocolVersion()}`)\;
                    this.sendMessage({type: 'error', error: `IncomingSocketConnection: incorrect protocol version ${body.message.protocolVersion} <> ${protocolVersion()}`});
                    this.disconnectLater();
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
            if (body.message.type === 'error') {
                console.warn(`Socket message error: ${body.message.error}`);
                this._webSocket.close();
                return;
            }
            this._onMessageCallbacks.forEach(cb => {
                validateNodeToNodeMessage(body.message);
                cb(body.message);
            });
        });
    }
    onInitialized(cb) {
        // assert(typeof(cb) === 'function');

        this._onInitializedCallbacks.push(cb);
    }
    remoteNodeId() {
        return this._remoteNodeId;
    }
    onMessage(cb) {
        // assert(typeof(cb) === 'function');

        this._onMessageCallbacks.push(cb);
    }
    onDisconnect(cb) {
        // assert(typeof(cb) === 'function');
        this._onDisconnectCallbacks.push(cb);
    }
    sendMessage(msg) {
        validateObject(msg, '/SocketMessage');

        if (this._disconnecting) return;
        const body = {
            fromNodeId: this._nodeId,
            message: msg,
            timestamp: (new Date()) - 0
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
    disconnectLater() {
        this._disconnecting = true;
        setTimeout(() => {
            this.disconnect();
        }, 2000);
    }
}

export class OutgoingConnectionError extends Error {
    constructor(errorString) {
        super(errorString);
        this.name = this.constructor.name
        Error.captureStackTrace(this, this.constructor);
    }
}

class OutgoingConnection {
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
        this._disconnecting = false;

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

        this._ws.on('error', (err) => {
            this._onErrorCallbacks.forEach(cb => cb(err));
            // this is important so we don't throw an exception
            // question: do we need to do something here? will 'close' be called also?
        });

        this._ws.on('message', messageText => {
            let messageParsed;
            try {
                messageParsed = JSON.parse(messageText);
            }
            catch(err) {
                this._webSocket.close();
                return;
            }
            if (messageParsed.type === 'error') {
                console.warn(`Socket message error: ${messageParsed.error}`);
                this._webSocket.close();
                return;
            }
            if (!validateObject(messageParsed, '/RawSocketMessage', {noThrow: true})) {
                this.disconnect();
                return;
            }
            const {body, signature} = messageParsed;
            validateNodeId(body.fromNodeId);
            validateObject(body.message, '/SocketMessage');
            if (this._remoteNodeId) {
                if (body.fromNodeId !== this._remoteNodeId) {
                    this.disconnect();
                    return;
                }
            }
            if (!verifySignature(body, signature, hexToPublicKey(body.fromNodeId), {checkTimestamp: true})) {
                this._ws.close();
                return;
            }            
            if (!this._accepted) {
                if (body.message.type === 'accepted') {
                    this._accepted = true;
                    this._remoteNodeId = body.fromNodeId;
                    this._onConnectCallbacks.forEach(cb => cb());
                    return;
                }
                else if (body.message.type === 'error') {
                    this._onErrorCallbacks.forEach(cb => cb(new OutgoingConnectionError(`Problem connecting to remote node: ${body.message.error}`)));
                    this.disconnect();
                    return;
                }
                else {
                    this.disconnect();
                    return;
                }
            }
            if (body.message.type === 'error') {
                console.warn(`Socket message error: ${body.message.error}`);
                this._webSocket.close();
                return;
            }
            this._onMessageCallbacks.forEach(cb => {
                validateNodeToNodeMessage(body.message);
                cb(body.message);
            });
        });
        this.sendMessage({
            type: 'initial',
            protocolVersion: protocolVersion()
        });
        setTimeout(() => {
            if (!this._accepted) {
                if (!this._isClosed) {
                    this.disconnect();
                }
            }
        }, 5000);
    }
    remoteNodeId() {
        return this._remoteNodeId;
    }
    disconnect() {
        this._ws.close();
    }
    onConnect(cb) {
        // assert(typeof(cb) === 'function');

        this._onConnectCallbacks.push(cb);
    }
    onError(cb) {
        // assert(typeof(cb) === 'function');

        this._onErrorCallbacks.push(cb);
    }
    onMessage(cb) {
        // assert(typeof(cb) === 'function');

        this._onMessageCallbacks.push(cb);
    }
    onDisconnect(cb) {
        // assert(typeof(cb) === 'function');

        this._onDisconnectCallbacks.push(cb);
    }
    sendMessage(msg) {
        validateObject(msg, '/SocketMessage');

        if (this._disconnecting) return;

        if (this._isOpen) {
            if (this._isClosed) {
                // log().warning('Cannot send message. Websocket is closed.', {address: this._address, port: this._port});
                return;
            }
            const body = {
                fromNodeId: this._nodeId,
                message: msg,
                timestamp: (new Date()) - 0
            };
            const message = {
                body,
                signature: getSignature(body, this._keyPair)
            };
            if (!verifySignature(message.body, message.signature, hexToPublicKey(this._nodeId))) {
                throw Error('Unexpected problem verifying outgoing signature');
            }
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
    disconnectLater() {
        this._disconnecting = true;
        setTimeout(() => {
            this.disconnect();
        }, 2000);
    }
}

export default SocketServer;