class Peer {
    constructor({peerId}) {
        this._peerId = peerId;
        this._onMessageCallbacks = [];
        this._incomingWebsocketConnection = null;
        this._outgoingWebsocketConnection = null;
        this._incomingUdpConnection = null;
        this._outgoingUdpConnection = null;
        this._isBootstrapPeer = false;
        this._halt = false;
    }
    peerId() {
        return this._peerId;
    }
    onMessage(cb) {
        this._onMessageCallbacks.push(cb);
    }
    setIsBootstrapPeer(val, bootstrapPeerInfo) {
        this._isBootstrapPeer = val;
        this._bootstrapPeerInfo = bootstrapPeerInfo;
    }
    isBootstrapPeer() {
        return this._isBootstrapPeer;
    }
    bootstrapPeerInfo() {
        return this._bootstrapPeerInfo;
    }
    sendMessage(message) {
        if (this._outgoingWebsocketConnection) {
            this._outgoingWebsocketConnection.sendMessage(message);
        }
        else if (this._incomingWebsocketConnection) {
            this._incomingWebsocketConnection.sendMessage(message);
        }
        else if (this._outgoingUdpConnection) {
            this._outgoingUdpConnection.sendMessage(message);
        }
        else if (this._incomingUdpConnection) {
            this._incomingUdpConnection.sendMessage(message);
        }
        else {
            throw Error('Could not send message. No connection.')
        }
    }
    setIncomingConnection({type, connection}) {
        if (type === 'websocket') {
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
    setOutgoingConnection({type, connection}) {
        if (type === 'websocket') {
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
    disconnect() {
        this._halt = true;
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
    hasIncomingWebsocketConnection() {
        return this._incomingWebsocketConnection ? true : false;
    }
    hasOutgoingWebsocketConnection() {
        return this._outgoingWebsocketConnection ? true : false;
    }
    hasWebsocketConnection() {
        return this.hasIncomingWebsocketConnection() || this.hasOutgoingWebsocketConnection();
    }
    hasIncomingUdpConnection() {
        return this._incomingUdpConnection ? true : false;
    }
    hasOutgoingUdpConnection() {
        return this._outgoingUdpConnection ? true : false;
    }
    hasUdpConnection() {
        return this.hasIncomingUdpConnection() || this.hasOutgoingUdpConnection();
    }
    hasIncomingConnection() {
        return this.hasIncomingWebsocketConnection() || this.hasIncomingUdpConnection();
    }
    hasOutgoingConnection() {
        return this.hasOutgoingWebsocketConnection() || this.hasOutgoingUdpConnection();
    }
    hasConnection() {
        return this.hasWebsocketConnection() || this.hasUdpConnection();
    }

    _handleMessage(message) {
        this._onMessageCallbacks.forEach(cb => {
            cb(message);
        });
    }
}

export default Peer;