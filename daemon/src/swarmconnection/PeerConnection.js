import WebsocketConnection from './WebsocketConnection.js';
import { sleepMsec } from '../common/util.js';
import { JSONStringifyDeterministic } from '../common/crypto_util.js'
import { log } from '../common/log.js';
import UdpClientConnection from '../UdpClientConnection.js';

class PeerConnection {
    constructor({ udpConnectionManager, keyPair, swarmName, nodeId, peerId, protocolVersion }) {
        this._udpConnectionManager = udpConnectionManager;
        this._keyPair = keyPair;
        this._swarmName = swarmName;
        this._nodeId = nodeId;
        this._peerId = peerId;
        this._peerNodeInfo = null;
        this._incomingWebsocketConnection = null;
        this._outgoingWebsocketConnection = null;
        this._incomingUdpConnection = null;
        this._outgoingUdpConnection = null;
        this._scheduleTryOutgoingWebsocketConnection = false;
        this._scheduleTryOutgoingUdpConnection = false;
        this._tryingOutgoingWebsocketConnection = false;
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
    hasOutgoingUdpConnection() {
        return this._outgoingUdpConnection ? true : false;
    }
    hasWebsocketConnection() {
        return this.hasIncomingWebsocketConnection() || this.hasOutgoingWebsocketConnection();
    }
    hasUdpConnection() {
        return this.hasIncomingUdpConnection() || this.hasOutgoingUdpConnection();
    }
    hasDirectConnection() {
        return this.hasWebsocketConnection() || this.hasUdpConnection();
    }
    setPeerNodeInfo(peerNodeInfo) {
        if ((this._peerNodeInfo) && (JSONStringifyDeterministic(peerNodeInfo) === JSONStringifyDeterministic(this._peerNodeInfo))) {
            // not a change
            return;
        }
        log().info(`SWARM:: Setting peer node info.`, {peerId: this._peerId, peerNodeInfo});

        this._peerNodeInfo = peerNodeInfo;
        this._scheduleTryOutgoingWebsocketConnection = true;
        this._scheduleTryOutgoingUdpConnection = true; // don't worry, it won't try until after we try the websocket connection
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
            this._handleSignedMessage(msg);
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
            this._handleSignedMessage(msg);
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
        if (this._outgoingWebsocketConnection) {
            this._outgoingWebsocketConnection.sendMessage(msg);
        }
        else if (this._incomingWebsocketConnection) {
            this._incomingWebsocketConnection.sendMessage(msg);
        }
        else if (this._outgoingUdpConnection) {
            this._outgoingUdpConnection.sendMessage(msg);
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
        if (this._outgoingUdpConnection) {
            this._outgoingUdpConnection.disconnect();
        }
        this._halt = true;
    }
    _handleSignedMessage = (msg) => {
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

    // try outgoing websocket connection and return true or false
    async tryOutgoingWebsocketConnection() {
        return new Promise((resolve, reject) => {
            const peerNodeInfo = this._peerNodeInfo;
            if ((peerNodeInfo) && (peerNodeInfo.port)) {
                let host = peerNodeInfo.host;
                let port = peerNodeInfo.port;
                if (peerNodeInfo.local) {
                    host = 'localhost';
                }
                if (!host) {
                    resolve(false);
                    return;
                }
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
                    log().info(`Outgoing websocket connection established`, {peerId: this._peerId});
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
                        log().warning(`Problem sending initial message in outgoing websocket connection`, {peerId: this._peerId});
                        resolve(false);
                        return;
                    }
                    C.onMessage(msg => {
                        this._handleSignedMessage(msg);
                    });
                    C.onDisconnect(() => {
                        if (this._outgoingWebsocketConnection === C) {
                            log().info(`Outgoing websocket connection disconnected`, {peerId: this._peerId});
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
    // try outgoing udp connection and return true or false
    async tryOutgoingUdpConnection() {
        return new Promise((resolve, reject) => {
            const peerNodeInfo = this._peerNodeInfo;
            if ((peerNodeInfo) && (peerNodeInfo.udpAddress) && (peerNodeInfo.udpPort)) {
                const udpAddress = peerNodeInfo.udpAddress;
                const udpPort = peerNodeInfo.udpPort;
                const C = this._udpConnectionManager.createOutgoingConnection({
                    remoteAddress: udpAddress,
                    remotePort: udpPort
                });
                let connected = false;
                let errored = false;
                C.onError(() => { // todo: implement this
                    errored = true;
                    if (connected) {
                        // presumably we'll get a disconnect below
                        return;
                    }
                    resolve(false);
                });
                C.onMessage(msg => {
                    this._handleSignedMessage(msg);
                });
                C.onDisconnect(() => {
                    if (this._outgoingUdpConnection === C) {
                        log().info(`Outgoing udp connection disconnected`, {peerId: this._peerId});
                        this._outgoingUdpConnection = null;
                    }
                });
                C.onConnect(() => {
                    if (errored) {
                        log().warning(`Unexpected. We connected udp, but also errored.`, {peerId: this._peerId});
                        C.disconnect();
                        return;
                    }
                    if (connected) {
                        log().warning(`Unexpected. Already connected to udp.`, {peerId: this._peerId});
                        C.disconnect();
                        return;
                    }
                    if (C.remoteNodeId() !== this._peerId) {
                        log().warning(`Unexpected. Node ID mismatch.`, {peerId: this._peerId, remoteNodeId: C.remoteNodeId()});
                        C.disconnect();
                        return;
                    }
                    connected = true;
                    log().info(`Outgoing udp connection established`, {peerId: this._peerId}); 
                    C.sendMessage({
                        initialInfo: {
                            swarmName: this._swarmName
                        }
                    });
                    this._outgoingUdpConnection = C;
                    this._onUdpConnectionCallbacks.forEach(cb => cb());
                    resolve(true);
                    // this._sendQueuedMessages();
                });
            }
            else {
                resolve(false);
            }
        });
    }
    async _startTryingOutgoingWebsocketConnection() {
        let timeLastTry = new Date();
        while (true) {
            if (this._halt) return;
            if ((!this._outgoingWebsocketConnection) && (this._peerNodeInfo)) {
                const elapsed = (new Date()) - timeLastTry;
                if ((this._scheduleTryOutgoingWebsocketConnection) || (elapsed > 5000)) {
                    timeLastTry = new Date();
                    this._scheduleTryOutgoingWebsocketConnection = false;
                    this._tryingOutgoingWebsocketConnection = true;
                    try {
                        await this.tryOutgoingWebsocketConnection();
                    }
                    finally {
                        this._tryingOutgoingWebsocketConnection = false;
                    }
                }
            }
            await sleepMsec(100);
        }
    }
    async _startTryingOutgoingUdpConnection() {
        let timeLastTry = new Date();
        while (true) {
            if (this._halt) return;
            // first make sure we are not trying websocket -- because that's highest priority
            if ((!this._outgoingUdpConnection) && (!this._outgoingWebsocketConnection) && (!this._incomingWebsocketConnection) && (this._peerNodeInfo)) {
                if ((!this._scheduleTryOutgoingWebsocketConnection) && (!this._tryingOutgoingWebsocketConnection)) {
                    const elapsed = (new Date()) - timeLastTry;
                    if ((this._scheduleTryOutgoingUdpConnection) || (elapsed > 5000)) {
                        timeLastTry = new Date();
                        this._scheduleTryOutgoingUdpConnection = false;
                        await this.tryOutgoingUdpConnection();
                    }
                }
            }
            await sleepMsec(100);
        }
    }
    async _start() {
        this._startTryingOutgoingWebsocketConnection();
        this._startTryingOutgoingUdpConnection();
        
        while (true) {
            if (this._halt) return;
            
            await sleepMsec(100);
        }
    }
}

export default PeerConnection;