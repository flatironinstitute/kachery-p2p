import { sleepMsec, randomAlphaString } from "./common//util.js";
import assert from 'assert';
import { sha1sum } from "./common//crypto_util.js";
import { timeStamp } from "console";
import { validateObject, validateNodeToNodeMessage, validateNodeData, validatePort, validateNodeId } from "./schema/index.js";

class RemoteNode {
    constructor({ remoteNodeManager, remoteNodeId }) {
        validateNodeId(remoteNodeId);

        this._remoteNodeManager = remoteNodeManager;
        this._node = this._remoteNodeManager._node;
        this._websocketServer = this._node._websocketServer;
        this._udpServer = this._node._udpServer;
        this._remoteNodeId = remoteNodeId;
        this._localNodeInfo = null;
        this._halt = false;

        this._remoteNodeData = null;
        this._remoteNodeDataTimestamp = null;
        this._remoteNodeDataInternalTimestamp = new Date();

        this._remoteNodeLocalAddress = null;
        this._remoteNodeLocalPort = null;

        // todo: figure out when to set these
        this._bootstrapPeerInfo = null;

        this._incomingUdpConnection = null;
        this._incomingWebsocketConnection = null;
        this._outgoingUdpConnection = null;
        this._outgoingWebsocketConnection = null;

        this._incomingUdpDisconnectTimestamp = 0;
        this._incomingWebsocketDisconnectTimestamp = 0;
        this._outgoingUdpDisconnectTimestamp = 0;
        this._outgoingWebsocketDisconnectTimestamp = 0;

        this._onMessageCallbacks = [];
        this._onExpiredCallbacks = [];

        this._tryOutgoingConnectionIntervalMsec = {websocket: null, udp: null};
        this._outgoingConnectionErrorReported = {websocket: false, udp: false};

        this._handledIncomingMessageIds = {};
        this._unconfirmedOutgoingMessages = {};

        // todo: establish outgoing connections

        this._start();
    }
    bootstrapPeerInfo() {
        return cloneObject(this._bootstrapPeerInfo);
    }
    halt() {
        this._halt = true;
        this.disconnect();
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
    }
    disconnectOutgoingConnections() {
        if (this._outgoingWebsocketConnection) {
            this._outgoingWebsocketConnection.disconnect();
        }
        if (this._outgoingUdpConnection) {
            this._outgoingUdpConnection.disconnect();
        }
    }
    hasIncomingConnection() {
        return this.hasIncomingUdpConnection() || this.hasIncomingWebsocketConnection();
    }
    hasIncomingUdpConnection() {
        return this._incomingUdpConnection ? true : false;
    }
    hasIncomingWebsocketConnection() {
        return this._incomingWebsocketConnection ? true : false;
    }
    hasOutgoingConnection() {
        return this.hasOutgoingUdpConnection() || this.hasOutgoingWebsocketConnection();
    }
    hasOutgoingConnectionOfType(type) {
        if (type === 'websocket') return this.hasOutgoingWebsocketConnection();
        else if (type === 'udp') return this.hasOutgoingUdpConnection();
        else throw Error('Unexpected type.');
    }
    hasOutgoingUdpConnection() {
        return this._outgoingUdpConnection ? true : false;
    }
    hasOutgoingWebsocketConnection() {
        return this._outgoingWebsocketConnection ? true : false;
    }
    hasUdpConnection() {
        return this.hasIncomingUdpConnection() || this.hasOutgoingUdpConnection();
    }
    hasWebsocketConnection() {
        return this.hasIncomingWebsocketConnection() || this.hasOutgoingWebsocketConnection();
    }
    hasConnection() {
        return this.hasIncomingConnection() || this.hasOutgoingConnection();
    }
    isBootstrap() {
        return this._bootstrapPeerInfo ? true : false;
    }
    remoteNodeLocalAddress() {
        return this._remoteNodeLocalAddress;
    }
    remoteNodeLocalPort() {
        return this._remoteNodeLocalPort;
    }
    isExpired() {
        const elapsed = (new Date()) - this._remoteNodeDataInternalTimestamp;
        return (elapsed > 60000);
    }
    onExpired(cb) {
        assert(typeof(cb) === 'function');

        this._onExpiredCallbacks.push(cb);
    }
    onMessage(cb) {
        assert(typeof(cb) === 'function');

        this._onMessageCallbacks.push(cb);
    }
    remoteNodeData() {
        return cloneObject(this._remoteNodeData);
    }
    remoteNodeInfo() {
        if (!this._remoteNodeData) return null;
        return cloneObject(this._remoteNodeData.body.nodeInfo);
    }
    sendMessage(message) {        
        validateNodeToNodeMessage(message);

        if (!message._confirmId) {
            if (!message._id) {
                message._id = randomAlphaString(10);
                this._unconfirmedOutgoingMessages[message.id] = {
                    timestamp: new Date(),
                    message,
                    numTries: 1
                };
            }
        }

        let udpFirst = false;
        if (udpFirst) {
            if (this._outgoingUdpConnection) {
                this._outgoingUdpConnection.sendMessage(message);
                return;
            }
            if (this._incomingUdpConnection) {
                this._incomingUdpConnection.sendMessage(message);
                return;
            }    
        }

        if (this._outgoingWebsocketConnection) {
            this._outgoingWebsocketConnection.sendMessage(message);
            return;
        }
        if (this._incomingWebsocketConnection) {
            this._incomingWebsocketConnection.sendMessage(message);
            return;
        }
        if (this._outgoingUdpConnection) {
            this._outgoingUdpConnection.sendMessage(message);
            return;
        }
        if (this._incomingUdpConnection) {
            this._incomingUdpConnection.sendMessage(message);
            return;
        }
        throw Error('Could not send message. No connection.')
    }
    setIncomingConnection({ type, connection }) {
        assert(['websocket', 'udp'].includes(type));
        assert(connection);

        if (type === 'websocket') {
            if ((this._incomingWebsocketConnection) && (this._incomingWebsocketConnection !== connection)) {
                this._incomingWebsocketConnection.disconnect();
            }
            this._incomingWebsocketConnection = connection;
            connection.onMessage(msg => {
                if (connection === this._incomingWebsocketConnection) {
                    this._handleMessage(msg)
                }
            });
            connection.onDisconnect(() => {
                if (connection === this._incomingWebsocketConnection) {
                    this._incomingWebsocketConnection = null;
                    this._incomingWebsocketDisconnectTimestamp = new Date();
                }
            });
        }
        else if (type === 'udp') {
            if ((this._incomingUdpConnection) && (this._incomingUdpConnection !== connection)) {
                this._incomingUdpConnection.disconnect();
            }
            this._incomingUdpConnection = connection;
            connection.onMessage(msg => {
                if (connection === this._incomingUdpConnection) {
                    this._handleMessage(msg)
                }
            });
            connection.onDisconnect(() => {
                if (connection === this._incomingUdpConnection) {
                    this._incomingUdpConnection = null;
                    this._incomingUdpDisconnectTimestamp = new Date();
                }
            });
        }
    }
    setOutgoingConnection({ type, connection }) {
        assert(['websocket', 'udp'].includes(type));
        assert(connection);

        if (type === 'websocket') {
            if ((this._outgoingWebsocketConnection) && (this._outgoingWebsocketConnection !== connection)) {
                this._outgoingWebsocketConnection.disconnect();
            }
            this._outgoingWebsocketConnection = connection;
            connection.onMessage(msg => {
                if (connection === this._outgoingWebsocketConnection) {
                    this._handleMessage(msg)
                }
            });
            connection.onDisconnect(() => {
                if (connection === this._outgoingWebsocketConnection) {
                    this._outgoingWebsocketConnection = null;
                    this._outgoingWebsocketDisconnectTimestamp = new Date();
                }
            });
        }
        else if (type === 'udp') {
            if ((this._outgoingUdpConnection) && (this._outgoingUdpConnection !== connection)) {
                this._outgoingUdpConnection.disconnect();
            }
            this._outgoingUdpConnection = connection;
            connection.onMessage(msg => {
                if (connection === this._outgoingUdpConnection) {
                    this._handleMessage(msg)
                }
            });
            connection.onDisconnect(() => {
                if (connection === this._outgoingUdpConnection) {
                    this._outgoingUdpConnection = null;
                    this._outgoingUdpDisconnectTimestamp = new Date();
                }
            });
        }
    }
    setBootstrapPeerInfo(bootstrapPeerInfo) {
        validateObject(bootstrapPeerInfo, '/BootstrapPeerInfo');

        this._bootstrapPeerInfo = cloneObject(bootstrapPeerInfo);
    }
    setRemoteNodeData(data) {
        validateNodeData(data);

        let doSet = false;
        if (this._remoteNodeData) {
            const difference = data.body.timestamp - this._remoteNodeData.body.timestamp;
            if (difference > 0) {
                doSet = true;
            }
        }
        else {
            doSet = true;
        }
        if (doSet) {
            const oldRemoteNodeData = cloneObject(this._remoteNodeData);
            this._remoteNodeData = data;
            this._remoteNodeDataInternalTimestamp = new Date();
            this._tryOutgoingConnectionIntervalMsec = {websocket: 1000, udp: 1000}; // trigger connection attempt soon
            if (oldRemoteNodeData) {
                if ((this._remoteNodeData.udpAddress !== oldRemoteNodeData.udpAddress) || (this._remoteNodeData.udpPort !== oldRemoteNodeData.udpPort)) {
                    if (this._outgoingUdpConnection) {
                        // disconnect because we have new connetion information
                        this._outgoingUdpConnection.disconnect();
                    }                    
                }
                if ((this._remoteNodeData.address !== oldRemoteNodeData.address) || (this._remoteNodeData.port !== oldRemoteNodeData.port)) {
                    if (this._outgoingWebsocketConnection) {
                        // disconnect because we have new connetion information
                        this._outgoingWebsocketConnection.disconnect();
                    }                    
                }
            }
        }
    }
    setRemoteNodeLocalAddress({localAddress, localPort}) {
        validateObject(localAddress, '/Address');
        validatePort(localPort);

        this._remoteNodeLocalAddress = localAddress;
        this._remoteNodeLocalPort = localPort;
    }
    setLocalNodeInfo(nodeInfo) {
        validateObject(nodeInfo, '/NodeInfo');

        this._localNodeInfo = nodeInfo;
        // todo: trigger events here?
    }
    _handleMessage(message) {
        validateNodeToNodeMessage(message);

        if (message._confirmId) {
            if (message._confirmId in this._unconfirmedOutgoingMessages) {
                delete this._unconfirmedOutgoingMessages[message._confirmId];
            }
            return;
        }
        assert(message._id, 'Missing message id');

        // important to send confirmation even if we already handled it. Because maybe the last confirmation was not received.
        this.sendMessage({_confirmId: message._id});

        // check if already handled
        if (message._id in this._handledIncomingMessageIds) {
            // already handled
            return
        }

        // todo: clean up this memory leak
        this._handledIncomingMessageIds[message._id] = {timestamp: new Date()};

        this._onMessageCallbacks.forEach(cb => cb(message));
    }

    async _startCheckingExpired() {
        const delayMsec = 10000;
        while (true) {
            await sleepMsec(delayMsec);
            if (this._halt) return;
            if (this.isExpired()) {
                this._onExpiredCallbacks.forEach(cb => cb());
            }
        }
    }
    async _tryOutgoingConnection({type}) {
        assert(['websocket', 'udp'].includes(type));

        const remoteNodeInfo = this.remoteNodeInfo();
        if (!remoteNodeInfo) return false;
        let server, address, port;
        if (type === 'websocket') {
            server = this._websocketServer;
            address = remoteNodeInfo.address || this._remoteNodeLocalAddress;
            port = remoteNodeInfo.port || this._remoteNodeLocalPort;
        }
        else if (type === 'udp') {
            server = this._udpServer;
            address = remoteNodeInfo.udpAddress;
            port = remoteNodeInfo.udpPort;
        }
        if ((!address) || (!port)) return false;
        const remoteNodeId = remoteNodeInfo.nodeId;
        let C;
        try {
            C = await server.createOutgoingConnection({
                address,
                port,
                remoteNodeId
            });
        }
        catch (err) {
            if (!this._outgoingConnectionErrorReported[type]) {
                // console.warn(`Problem creating outgoing ${type} connection to ${remoteNodeId.slice(0, 6)} ${address}:${port}. ${err.message}`);
                this._outgoingConnectionErrorReported[type] = true;
            }
            return false;
        }
        if (!C) {
            if (!this._outgoingConnectionErrorReported[type]) {
                // console.warn(`Unable to create outgoing ${type} connection to ${remoteNodeId.slice(0, 6)} ${address}:${port}.`);
                this._outgoingConnectionErrorReported[type] = true;
            }
            return false;
        }
        // console.info(`Created outgoing ${type} connection to ${remoteNodeId.slice(0, 6)} ${address}:${port}.`);
        this._outgoingConnectionErrorReported[type] = false;
        this.setOutgoingConnection({type, connection: C});
        return true;
    }

    async _startTryingOutgoingConnection({type}) {
        assert(['websocket', 'udp'].includes(type));
        
        // start aggressively and slow down on failure
        // this can be reduced elsewhere in the code
        this._tryOutgoingConnectionIntervalMsec[type] = 1000;
        while (true) {
            const timer = new Date();
            while (true) {
                const elapsed = (new Date()) - timer;
                if (elapsed > this._tryOutgoingConnectionIntervalMsec[type]) {
                    break;
                }
                await sleepMsec(2000);
            }
            if (this._halt) return;
            if (this.hasOutgoingConnectionOfType(type)) {
                this._tryOutgoingConnectionIntervalMsec[type] = 1000;
            }
            else {
                const remoteNodeInfo = this.remoteNodeInfo();
                let okayToTry = false;
                if ((remoteNodeInfo) && (this._localNodeInfo)) {
                    if (type === 'websocket') {
                        okayToTry = ((remoteNodeInfo.address || this._remoteNodeLocalAddress) && (remoteNodeInfo.port || this._remoteNodeLocalPort));
                        const elapsedFromDisconnect = (new Date()) - this._outgoingWebsocketDisconnectTimestamp;
                        if (elapsedFromDisconnect < 10000) {
                            // too soon from disconnect
                            okayToTry = false;
                        }
                    }
                    else if (type === 'udp') {
                        if ((remoteNodeInfo.udpAddress) && (remoteNodeInfo.udpPort)) {
                            // if ((remoteNodeInfo.address) && (remoteNodeInfo.address !== 'localhost')) {
                            if (remoteNodeInfo.address) {
                                // the remote node has an exposed address, so let's try
                                okayToTry = true;
                            }
                            else {
                                // we will try only if we have our own udp address (hole punching)
                                okayToTry = ((this._localNodeInfo) && (this._localNodeInfo.udpAddress) && (this._localNodeInfo.udpPort));
                            }
                            const elapsedFromDisconnect = (new Date()) - this._outgoingUdpDisconnectTimestamp;
                            if (elapsedFromDisconnect < 10000) {
                                // too soon from disconnect
                                okayToTry = false;
                            }
                        } 
                    }
                    if (okayToTry) {
                        if (!await this._tryOutgoingConnection({type})) {
                            this._tryOutgoingConnectionIntervalMsec[type] *= 2;
                            if (this._tryOutgoingConnectionIntervalMsec[type] > 16000)
                                this._tryOutgoingConnectionIntervalMsec[type] = 16000;
                            if (this._tryOutgoingConnectionIntervalMsec[type] < 1000)
                                this._tryOutgoingConnectionIntervalMsec[type] = 1000;
                        }
                    }
                    else {
                        this._tryOutgoingConnectionIntervalMsec[type] = 1000;
                    }
                }
                else {
                    this._tryOutgoingConnectionIntervalMsec[type] = 1000;
                }
            }
        }
    }

    async _startAnnouncingSelf() {
        // start aggressive and slow down
        let delayMsec = 1000;
        while (true) {
            await sleepMsec(delayMsec);
            if (this._halt) return;

            this._node._announceSelfToPeersAndJoinedChannelsNow();
            delayMsec *= 2;
            if (delayMsec > 10000) {
                delayMsec = 10000;
            }
        }
    }

    async _startResendingUnconfirmedMessages() {
        let delayMsec = 2000;
        while (true) {
            await sleepMsec(delayMsec);
            if (this._halt) return;

            for (let id in this._unconfirmedOutgoingMessages) {
                const x = this._unconfirmedOutgoingMessages[id];
                const elapsed = (new Date()) - x.timestamp;
                if (elapsed > 5000) {
                    if (x.numTries >=4 ) {
                        console.warn(`Did not get confirmation for message after ${x.numTries} tries. Disconnecting peer.`);
                        this.disconnect();
                        return;
                    }
                    x.numTries ++;
                    x.timestamp = new Date();
                    if (this.hasConnection()) {
                        this.sendMessage(x.message);
                    }
                }
            }
        }
    }

    async _start() {
        this._startCheckingExpired();
        this._startTryingOutgoingConnection({type: 'websocket'});
        this._startTryingOutgoingConnection({type: 'udp'});
        this._startAnnouncingSelf();
        this._startResendingUnconfirmedMessages();
    }
}

function cloneObject(obj) {
    if (!obj) return obj;
    return JSON.parse(JSON.stringify(obj));
}

export default RemoteNode;