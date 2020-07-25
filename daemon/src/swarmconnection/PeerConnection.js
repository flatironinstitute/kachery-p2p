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
        this._incomingUdpConnection = null;
        this._scheduleOutgoingWebsocketConnection = false;
        this._onSignedMessageCallbacks = [];
        this._onWebsocketConnectionCallbacks = [];
        this._onUdpConnectionCallbacks = [];
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
    hasIncomingUdpConnection() {
        return this._incomingUdpConnection ? true : false;
    }
    hasWebsocketConnection() {
        return this.hasIncomingWebsocketConnection() || this.hasOutgoingWebsocketConnection();
    }
    hasUdpConnection() {
        return this.hasIncomingUdpConnection();
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
        log().info(`Incoming websocket connection established`, {peerId: this._peerId});
        if (this._incomingWebsocketConnection) {
            this._incomingWebsocketConnection.disconnect();
        }
        this._incomingWebsocketConnection = connection;
        connection.onMessage(msg => {
            this._handleMessage(msg);
        });
        connection.onDisconnect(() => {
            if (this._incomingWebsocketConnection === connection) {
                log().info(`Incoming websocket connection disconnected`, {peerId: this._peerId});
                this._incomingWebsocketConnection = null;
            }
        });
        this._onWebsocketConnectionCallbacks.forEach(cb => cb());
        // this._sendQueuedMessages();
    }
    setIncomingUdpConnection(connection) {
        log().info(`Incoming udp connection established`, {peerId: this._peerId});
        if (this._incomingUdpConnection) {
            this._incomingUdpConnection.disconnect();
        }
        this._incomingUdpConnection = connection;
        connection.onMessage(msg => {
            this._handleMessage(msg);
        });
        connection.onDisconnect(() => {
            if (this._incomingUdpConnection === connection) {
                log().info(`Incoming udp connection disconnected`, {peerId: this._peerId});
                this._incomingUdpConnection = null;
            }
        });
        this._onUdpConnectionCallbacks.forEach(cb => cb());
        // this._sendQueuedMessages();
    }
    onSignedMessage(cb) {
        this._onSignedMessageCallbacks.push(cb);
    }
    onWebsocketConnection(cb) {
        this._onWebsocketConnectionCallbacks.push(cb);
    }
    onUdpConnection(cb) {
        this._onUdpConnectionCallbacks.push(cb);
    }
    sendSignedMessage(msg) {
        if (this._incomingWebsocketConnection) {
            this._incomingWebsocketConnection.sendMessage(msg);
        }
        else if (this._outgoingWebsocketConnection) {
            this._outgoingWebsocketConnection.sendMessage(msg);
        }
        else if (this._incomingUdpConnection) {
            this._incomingUdpConnection.sendMessage(msg);
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
        if (this._incomingUdpConnection) {
            this._incomingUdpConnection.disconnect();
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

    // todo: try outgoing udp connection

    // try outgoing connection and return true or false
    async tryOutgoingWebsocketConnection() {
        return new Promise((resolve, reject) => {
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
                    log().info(`Problem establishing outgoing websocket connection`, {peerId: this._peerId, host, port});
                    resolve(false);
                    return;
                }
                let connected = false;
                let errored = false;
                C.onError(() => {
                    errored = true;
                    if (connected) {
                        // presumably we'll get a disconnect below
                        return;
                    }
                    resolve(false);
                });
                C.onConnect(() => {
                    if (errored) {
                        log().info(`Unexpected. We connected, but also errored.`, {peerId: this._peerId});
                        return;
                    }
                    connected = true;
                    log().info(`Outgoing connection established`, {peerId: this._peerId});
                    try {
                        C.sendMessage({
                            type: 'initial',
                            initialInfo: {
                                swarmName: this._swarmName,
                                protocolVersion: this._protocolVersion,
                                nodeId: this._nodeId
                            }
                        });
                    }
                    catch(err) {
                        log().warning(`Problem sending initial message in outgoing connection`, {peerId: this._peerId});
                        resolve(false);
                        return;
                    }
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
                    resolve(true);
                    // this._sendQueuedMessages();
                });
            }
        });
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
                    await this.tryOutgoingWebsocketConnection();
                }
            }
            await sleepMsec(100);
        }
    }
}

export default PeerConnection;