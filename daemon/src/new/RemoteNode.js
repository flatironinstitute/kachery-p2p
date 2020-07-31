import { sleepMsec } from "../common/util.js";

class RemoteNode {
    constructor({ remoteNodeManager, remoteNodeId }) {
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

        // todo: figure out when to set these
        this._bootstrapPeerInfo = null;

        this._incomingUdpConnection = null;
        this._incomingWebsocketConnection = null;
        this._outgoingUdpConnection = null;
        this._outgoingWebsocketConnection = null;

        this._onMessageCallbacks = [];
        this._onExpiredCallbacks = [];

        this._tryOutgoingConnectionIntervalMsec = {websocket: null, udp: null};
        this._outgoingConnectionErrorReported = {websocket: false, udp: false};

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
    inAJoinedChannel() {
        const channels = this.remoteNodeChannels();
        if (!channels) return false;
        for (let channelName in this._node._channels) {
            if (channelName in channels) return true;
        }
        return false;
    }
    isBootstrap() {
        return this._bootstrapPeerInfo ? true : false;
    }
    onExpired(cb) {
        this._onExpiredCallbacks.push(cb);
    }
    onMessage(cb) {
        this._onMessageCallbacks.push(cb);
    }
    remoteNodeData() {
        return cloneObject(this._remoteNodeData);
    }
    remoteNodeInfo() {
        if (!this._remoteNodeData) return null;
        return cloneObject(this._remoteNodeData.body.nodeInfo);
    }
    remoteNodeChannels() {
        if (!this._remoteNodeData) return null;
        return cloneObject(this._remoteNodeData.body.channels);
    }
    sendMessage(message) {
        this._node._validateMessage(message);
        if (this._outgoingUdpConnection) {
            this._outgoingUdpConnection.sendMessage(message);
        }
        else if (this._incomingUdpConnection) {
            this._incomingUdpConnection.sendMessage(message);
        }
        else if (this._outgoingWebsocketConnection) {
            this._outgoingWebsocketConnection.sendMessage(message);
        }
        else if (this._incomingWebsocketConnection) {
            this._incomingWebsocketConnection.sendMessage(message);
        }
        else {
            throw Error('Could not send message. No connection.')
        }
    }
    setIncomingConnection({ type, connection }) {
        this._node._validateString(type);
        this._node._validateConnection(connection);
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
                }
            });
        }
    }
    setOutgoingConnection({ type, connection }) {
        this._node._validateString(type);
        this._node._validateConnection(connection);
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
                }
            });
        }
    }
    setBootstrapPeerInfo(bootstrapPeerInfo) {
        this._bootstrapPeerInfo = cloneObject(bootstrapPeerInfo);
    }
    setRemoteNodeData(data) {
        this._remoteNodeManager._validateRemoteNodeData(data);
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
            this._remoteNodeData = data;
            this._remoteNodeDataInternalTimestamp = new Date();
            this._tryOutgoingConnectionIntervalMsec = {websocket: 1000, udp: 1000}; // trigger connection attempt soon
        }
    }
    setLocalNodeInfo(nodeInfo) {
        this._node._validateNodeInfo(nodeInfo);
        this._localNodeInfo = nodeInfo;
        // todo: trigger events here?
    }
    _handleMessage(message) {
        this._onMessageCallbacks.forEach(cb => cb(message));
    }

    async _startCheckingExpired() {
        const delayMsec = 10000;
        while (true) {
            await sleepMsec(delayMsec);
            if (this._halt) return;
            const elapsed = (new Date()) - this._remoteNodeDataInternalTimestamp;
            if (elapsed > 60000) {
                this._onExpiredCallbacks.forEach(cb => cb());
            }
        }
    }
    async _tryOutgoingConnection({type}) {
        const remoteNodeInfo = this.remoteNodeInfo();
        if (!remoteNodeInfo) return false;
        let server, address, port;
        if (type === 'websocket') {
            server = this._websocketServer;
            address = remoteNodeInfo.address;
            port = remoteNodeInfo.port;
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
                console.warn(`Problem creating outgoing ${type} connection to ${remoteNodeId.slice(0, 6)} ${address}:${port}. ${err.message}`);
                this._outgoingConnectionErrorReported[type] = true;
            }
            return false;
        }
        if (!C) {
            if (!this._outgoingConnectionErrorReported[type]) {
                console.warn(`Unable to create outgoing ${type} connection to ${remoteNodeId.slice(0, 6)} ${address}:${port}.`);
                this._outgoingConnectionErrorReported[type] = true;
            }
            return false;
        }
        console.info(`Created outgoing ${type} connection to ${remoteNodeId.slice(0, 6)} ${address}:${port}.`);
        this._outgoingConnectionErrorReported[type] = false;
        this.setOutgoingConnection({type, connection: C});
        return true;
    }

    async _startTryingOutgoingConnection({type}) {
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
                        okayToTry = ((remoteNodeInfo.address) && (remoteNodeInfo.port));
                    }
                    else if (type === 'udp') {
                        if ((remoteNodeInfo.udpAddress) && (remoteNodeInfo.udpPort)) {
                            //if ((remoteNodeInfo.address) && (remoteNodeInfo.address !== 'localhost')) {
                            if (remoteNodeInfo.address) {
                                // the remote node has an exposed address, so let's try
                                okayToTry = true;
                            }
                            else {
                                // we will try only if we have our own udp address (hole punching)
                                okayToTry = ((this._localNodeInfo) && (this._localNodeInfo.udpAddress) && (this._localNodeInfo.udpPort));
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

    async _start() {
        this._startCheckingExpired();
        this._startTryingOutgoingConnection({type: 'websocket'});
        this._startTryingOutgoingConnection({type: 'udp'});
        this._startAnnouncingSelf();
    }
}

function cloneObject(obj) {
    if (!obj) return obj;
    return JSON.parse(JSON.stringify(obj));
}

export default RemoteNode;