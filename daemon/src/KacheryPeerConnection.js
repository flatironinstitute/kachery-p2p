import WebSocket from 'ws';
import { sleepMsec } from './util.js';

class KacheryPeerConnection {
    constructor({ channel, nodeId, peerId, verbose }) {
        this._channel = channel;
        this._nodeId = nodeId;
        this._peerId = peerId;
        this._verbose = verbose;
        this._peerIsLocal = null;
        this._peerInfo = null;
        this._incomingConnection = null;
        this._outgoingConnection = null;
        this._onMessageCallbacks = [];
        this._queuedMessages = [];

        this._start();
    }
    async setPeerIsLocal(val) {
        this._peerIsLocal = val;
    }
    async setPeerInfo(peerInfo) {
        this._peerInfo = peerInfo;
    }
    setIncomingConnection(connection) {
        if (this._verbose >= 100) {
            console.info(`Incoming connection established: ${this._peerId}`);
        }
        this._incomingConnection = connection;
        connection.onMessage(msg => {
            this._handleMessage(msg);
        });
        connection.onDisconnect(() => {
            if (this._incomingConnection === connection) {
                this._incomingConnection = null;
            }
        });
        this._sendQueuedMessages();
    }
    onMessage(cb) {
        this._onMessageCallbacks.push(cb);
    }
    sendMessage(msg) {
        if (this._incomingConnection) {
            this._incomingConnection.sendMessage(msg);
        }
        else if (this._outgoingConnection) {
            this._outgoingConnection.sendMessage(msg);
        }
        else {
            this._queuedMessages.push(msg);
        }
    }
    disconnect() {
        if (this._incomingConnection) {
            this._incomingConnection.disconnect();
        }
        if (this._outgoingConnection) {
            this._outgoingConnection.disconnect();
        }
    }
    _handleMessage = (msg) => {
        this._onMessageCallbacks.forEach(cb => cb(msg));
    }
    _sendQueuedMessages = () => {
        const qm = this._queuedMessages;
        this._queuedMessages = [];
        qm.forEach(msg => {
            this.sendMessage(msg);
        });
    }
    async _tryOutgoingConnection() {
        const peerInfo = this._peerInfo;
        if ((peerInfo) && (peerInfo.listenPort)) {
            let listenHost = peerInfo.listenHost;
            if (this._peerIsLocal) {
                listenHost = 'localhost';
            }
            const C = new WebsocketConnection({ host: listenHost, port: peerInfo.listenPort });
            C.onConnect(() => {
                if (this._verbose >= 100) {
                    console.info(`Outgoing connection established: ${this._peerId}`);
                }
                C.sendMessage({
                    type: 'initial',
                    initialInfo: {
                        channel: this._channel,
                        nodeId: this._nodeId
                    }
                });
                C.onMessage(msg => {
                    this._handleMessage(msg);
                });
                C.onDisconnect(() => {
                    if (this._outgoingConnection === C) {
                        if (this._verbose >= 100) {
                            console.info(`Outgoing connection disconnected: ${this._peerId}`);
                        }
                        this._outgoingConnection = null;
                    }
                });
                this._outgoingConnection = C;
                this._sendQueuedMessages();
            });
        }
    }
    async _start() {
        await sleepMsec(500);
        while (true) {
            if (!this._outgoingConnection) {
                await this._tryOutgoingConnection();
            }
            await sleepMsec(5000);
        }
    }
}

class WebsocketConnection {
    constructor({ host, port }) {
        this._host = host;
        this._port = port;
        this._queuedMessages = [];
        this._onMessageCallbacks = [];
        this._onConnectCallbacks = [];
        this._onDisconnectCallbacks = [];
        this._isOpen = false;
        this._isClosed = false;
        this._ws = new WebSocket(`ws://${this._host}:${this._port}`);

        this._ws.on('open', () => {
            this._isOpen = true;
            this._onConnectCallbacks.forEach(cb => cb());
            this._sendQueuedMessages();
        });

        this._ws.on('close', () => {
            this._isClosed = true;
            this._onDisconnectCallbacks.forEach(cb => cb());
        });

        this._ws.on('error', () => {
            // this is important so we don't throw an exception
            // question: do we need to do something here? will 'close' be called also?
        });

        this._ws.on('message', msg => {
            const message = JSON.parse(msg);
            this._onMessageCallbacks.forEach(cb => {
                cb(message);
            });
        });
    }
    onConnect(cb) {
        this._onConnectCallbacks.push(cb);
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
                console.warn('Cannot send message. Websocket is closed.');
                return;
            }
            this._ws.send(JSON.stringify(msg));
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

export default KacheryPeerConnection;