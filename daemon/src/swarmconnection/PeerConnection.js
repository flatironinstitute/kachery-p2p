import WebsocketConnection from './WebsocketConnection.js';
import { sleepMsec } from '../common/util.js';

class PeerConnection {
    constructor({ swarmName, nodeId, peerId, verbose }) {
        this._swarmName = swarmName;
        this._nodeId = nodeId;
        this._peerId = peerId;
        this._verbose = verbose;
        this._incomingWebsocketConnection = null;
        this._outgoingWebsocketConnection = null;
        this._outgoingWebsocketConnectionLastTryTimestamp = 0;
        this._onMessageCallbacks = [];
        this._queuedMessages = [];

        this._start();
    }
    setPeerConnectInfo(peerConnectInfo) {
        if ((this._peerConnectInfo) && (JSON.stringify(peerConnectInfo) === JSON.stringify(this._peerConnectInfo))) {
            // not a change
            return;
        }
        this._peerConnectInfo = peerConnectInfo;
        this._outgoingWebsocketConnectionLastTryTimestamp = 0; // try right away
    }
    peerConnectInfo() {
        return this._peerConnectInfo;
    }
    setIncomingWebsocketConnection(connection) {
        if (this._verbose >= 100) {
            console.info(`Incoming connection established: ${this._peerId}`);
        }
        this._incomingWebsocketConnection = connection;
        connection.onMessage(msg => {
            this._handleMessage(msg);
        });
        connection.onDisconnect(() => {
            if (this._incomingWebsocketConnection === connection) {
                if (this._verbose >= 100) {
                    console.info(`Incoming connection disconnected: ${this._peerId}`);
                }
                this._incomingWebsocketConnection = null;
            }
        });
        this._sendQueuedMessages();
    }
    onMessage(cb) {
        this._onMessageCallbacks.push(cb);
    }
    sendMessage(msg) {
        if (this._incomingWebsocketConnection) {
            this._incomingWebsocketConnection.sendMessage(msg);
        }
        else if (this._outgoingWebsocketConnection) {
            this._outgoingWebsocketConnection.sendMessage(msg);
        }
        else {
            this._queuedMessages.push(msg);
        }
    }
    disconnect() {
        if (this._incomingWebsocketConnection) {
            this._incomingWebsocketConnection.disconnect();
        }
        if (this._outgoingWebsocketConnection) {
            this._outgoingWebsocketConnection.disconnect();
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
    async _tryOutgoingWebsocketConnection() {
        const peerConnectInfo = this._peerConnectInfo;
        if ((peerConnectInfo) && (peerConnectInfo.port)) {
            let host = peerConnectInfo.host;
            let port = peerConnectInfo.port;
            if (peerConnectInfo.local) {
                host = 'localhost';
            }
            let C;
            try {
                C = new WebsocketConnection({ host, port });
            }
            catch(err) {
                if (this._verbose >= 100) {
                    console.warn(`Problem establishing outgoing websocket connection to: ${host}:${port}`);
                }
                return;
            }
            C.onConnect(() => {
                if (this._verbose >= 100) {
                    console.info(`Outgoing connection established: ${this._peerId}`);
                }
                C.sendMessage({
                    type: 'initial',
                    initialInfo: {
                        swarmName: this._swarmName,
                        nodeId: this._nodeId
                    }
                });
                C.onMessage(msg => {
                    this._handleMessage(msg);
                });
                C.onDisconnect(() => {
                    if (this._outgoingWebsocketConnection === C) {
                        if (this._verbose >= 100) {
                            console.info(`Outgoing connection disconnected: ${this._peerId}`);
                        }
                        this._outgoingWebsocketConnection = null;
                    }
                });
                this._outgoingWebsocketConnection = C;
                this._sendQueuedMessages();
            });
        }
    }
    async _start() {
        while (true) {
            if (!this._outgoingWebsocketConnection) {
                const elapsedSinceLastTry = (new Date()) - this._outgoingWebsocketConnectionLastTryTimestamp;
                if (elapsedSinceLastTry > 5000) {
                    await this._tryOutgoingWebsocketConnection();
                    this._outgoingWebsocketConnectionLastTryTimestamp = new Date();
                }
            }
            await sleepMsec(100);
        }
    }
}

export default PeerConnection;