import WebsocketConnection from './WebsocketConnection.js';
import { sleepMsec } from '../common/util.js';
import { JSONStringifyDeterministic } from '../common/crypto_util.js'
import { log } from '../common/log.js';

class PeerConnection {
    constructor({ keyPair, swarmName, nodeId, peerId, protocolVersion }) {
        this._keyPair = keyPair;
        this._swarmName = swarmName;
        this._nodeId = nodeId;
        this._peerId = peerId;
        this._peerNodeInfo = null;
        this._incomingWebsocketConnection = null;
        this._outgoingWebsocketConnection = null;
        this._scheduleOutgoingWebsocketConnection = false;
        this._onSignedMessageCallbacks = [];
        this._onWebsocketConnectionCallbacks = [];
        this._routes = {};
        this._halt = false;
        this._protocolVersion = protocolVersion;
        // this._queuedMessages = [];

        this._start();
    }
    hasIncomingWebsocketConnection() {
        return this._incomingWebsocketConnection ? true : false;
    }
    hasOutgoingWebsocketConnection() {
        return this._outgoingWebsocketConnection ? true : false;
    }
    hasWebsocketConnection() {
        return this.hasIncomingWebsocketConnection() || this.hasOutgoingWebsocketConnection();
    }
    setPeerNodeInfo(peerNodeInfo) {
        if ((this._peerNodeInfo) && (JSONStringifyDeterministic(peerNodeInfo) === JSONStringifyDeterministic(this._peerNodeInfo))) {
            // not a change
            return;
        }

        log().info(`SWARM:: Setting peer node info.`, {peerId: this._peerId, peerNodeInfo});

        this._peerNodeInfo = peerNodeInfo;
        this._scheduleOutgoingWebsocketConnection = true;
    }
    peerNodeInfo() {
        return this._peerNodeInfo;
    }
    routes() {
        return this._routes;
    }
    setRoutes(routes) {
        this._routes = routes;
    }
    setIncomingWebsocketConnection(connection) {
        log().info(`Incoming connection established`, {peerId: this._peerId});
        this._incomingWebsocketConnection = connection;
        connection.onMessage(msg => {
            this._handleMessage(msg);
        });
        connection.onDisconnect(() => {
            if (this._incomingWebsocketConnection === connection) {
                log().info(`Incoming connection disconnected`, {peerId: this._peerId});
                this._incomingWebsocketConnection = null;
            }
        });
        this._onWebsocketConnectionCallbacks.forEach(cb => cb());
        // this._sendQueuedMessages();
    }
    onSignedMessage(cb) {
        this._onSignedMessageCallbacks.push(cb);
    }
    onWebsocketConnection(cb) {
        this._onWebsocketConnectionCallbacks.push(cb);
    }
    sendSignedMessage(msg) {
        if (this._incomingWebsocketConnection) {
            this._incomingWebsocketConnection.sendMessage(msg);
        }
        else if (this._outgoingWebsocketConnection) {
            this._outgoingWebsocketConnection.sendMessage(msg);
        }
        else {
            throw Error('Unable to send message to peer. No connections available.')
            // this._queuedMessages.push(msg);
        }
    }
    disconnect() {
        if (this._incomingWebsocketConnection) {
            this._incomingWebsocketConnection.disconnect();
        }
        if (this._outgoingWebsocketConnection) {
            this._outgoingWebsocketConnection.disconnect();
        }
        this._halt = true;
    }
    _handleMessage = (msg) => {
        this._onSignedMessageCallbacks.forEach(cb => cb(msg));
    }
    // _sendQueuedMessages = () => {
    //     const qm = this._queuedMessages;
    //     this._queuedMessages = [];
    //     qm.forEach(msg => {
    //         this.sendMessage(msg);
    //     });
    // }
    async _tryOutgoingWebsocketConnection() {
        const peerNodeInfo = this._peerNodeInfo;
        if ((peerNodeInfo) && (peerNodeInfo.port)) {
            let host = peerNodeInfo.host;
            let port = peerNodeInfo.port;
            if (peerNodeInfo.local) {
                host = 'localhost';
            }
            if (!host) return;
            let C;
            try {
                C = new WebsocketConnection({ host, port });
            }
            catch(err) {
                log().warning(`Problem establishing outgoing websocket connection`, {host, port});
                return;
            }
            C.onConnect(() => {
                log().info(`Outgoing connection established`, {peerId: this._peerId});
                C.sendMessage({
                    type: 'initial',
                    initialInfo: {
                        swarmName: this._swarmName,
                        protocolVersion: this._protocolVersion,
                        nodeId: this._nodeId
                    }
                });
                C.onMessage(msg => {
                    this._handleMessage(msg);
                });
                C.onDisconnect(() => {
                    if (this._outgoingWebsocketConnection === C) {
                        log().info(`Outgoing connection disconnected`, {peerId: this._peerId});
                        this._outgoingWebsocketConnection = null;
                    }
                });
                this._outgoingWebsocketConnection = C;
                this._onWebsocketConnectionCallbacks.forEach(cb => cb());
                // this._sendQueuedMessages();
            });
        }
    }
    async _start() {
        let timeLastOutgoingWebsocketTry = new Date();
        while (true) {
            if (this._halt) return;
            if ((!this._outgoingWebsocketConnection) && (this._peerNodeInfo)) {
                const elapsed = (new Date()) - timeLastOutgoingWebsocketTry;
                if ((this._scheduleOutgoingWebsocketConnection) || (elapsed > 5000)) {
                    timeLastOutgoingWebsocketTry = new Date();
                    this._scheduleOutgoingWebsocketConnection = false;
                    await this._tryOutgoingWebsocketConnection();
                }
            }
            await sleepMsec(100);
        }
    }
}

export default PeerConnection;