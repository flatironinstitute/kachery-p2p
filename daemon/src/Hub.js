import { sleepMsec } from './util.js'
import WebSocket from 'ws';

class Hub {
    constructor({ configDir, verbose }) {
        this._configDir = configDir;
        this._verbose = verbose

        const { publicKey, privateKey } = _loadKeypair(configDir);
        this._nodeConnections = {};
        this._swarmMemberships = {};

        this._start();
    }
    async _start() {
        while (true) {
            if (this._halted) return;
            // maintenance goes here
            // for example, managing the secondary file transfer swarms that we belong to
            await sleepMsec(100);
        }
    }
    _initializeNodeConnection(nodeConnection) {
        const nodeId = nodeConnection.nodeId();
        const _handleJoinSwarm = (topic) => {
            if (!this._swarmMemberships[topic]) {
                this._swarmMemberships[topic] = {};
            }
            if (!(nodeId in this._swarmMemberships[topic])) {
                this._swarmMemberships[topic][nodeId] = true;
                for (let ni in this._swarmMemberships[topic]) {
                    if (ni !== nodeId) {
                        const nc = this._nodeConnections[ni];
                        if (nc) {
                            nc.addPeer(topic, nodeConnection);
                        }
                    }
                }
            }
        }
        const _handleLeaveSwarm = (topic) => {
            if (topic in this._swarmMemberships) {
                for (let ni in this._swarmMemberships[topic]) {
                    if (ni !== nodeId) {
                        const nc = this._nodeConnections[ni];
                        if (nc) {
                            nc.removePeer(topic, nodeConnection);
                        }
                    }
                }
                if (this._swarmMemberships[topic]) {
                    if (this._swarmMemberships[topic][nodeId]) {
                        delete this._swarmMemberships[topic][nodeId];
                    }
                }
            }
        }
        nodeConnection.onJoinSwarm(topic => _handleJoinSwarm(topic));
        nodeConnection.onLeaveSwarm(topic => _handleLeaveSwarm(topic));
        nodeConnection.onDisconnect(() => {
            const swarmTopics = nodeConnection.swarmTopics();
            for (let topic of swarmTopics) {
                _handleLeaveSwarm(topic);
            }
            if (nodeId in this._nodeConnections) {
                delete this._nodeConnections[nodeId];
            }
        });
    }
    async listen(port) {
        const hubServer = new HubServer();
        hubServer.onNodeConnection(nodeConnection => {
            this._nodeConnections[nodeConnection.nodeId] = nodeConnection;
            this._initializeNodeConnection(nodeConnection);
        });
        await hubServer.listen(port);
    }
}

class NodeConnection {
    constructor(nodeId, websocketConnection) {
        this._nodeId = nodeId;
        this._websocketConnection = websocketConnection;

        this._swarms = {};
        this._onJoinSwarmCallbacks = [];
        this._onLeaveSwarmCallbacks = [];
        this._onDisconnectCallbacks = [];

        websocketConnection.onDisconnect(() => this._handleDisconnect());
        websocketConnection.onMessage(msg => this._handleMessage(msg));
    }
    nodeId() {
        return this._nodeId;
    }
    onJoinSwarm(cb) {
        this._onJoinSwarmCallbacks.push(cb);
    }
    onLeaveSwarm(cb) {
        this._onLeaveSwarmCallbacks.push(cb);
    }
    onDisconnect(cb) {
        this._onDisconnectCallbacks.push(cb);
    }
    swarmTopics() {
        return Object.keys(this._swarms);
    }
    addPeer(topic, peerConnection) {
        if (!(topic in this._swarms)) {
            console.warn(`Unexpected addPeer for topic: ${topic}`);
            return;
        }
        this._swarms[topic].peers[peerConnection.nodeId()] = peerConnection;
    }
    removePeer(topic, peerConnection) {
        if (!(topic in this._swarms)) {
            console.warn(`Unexpected removePeer for topic (no swarm): ${topic}`);
            return;
        }
        if (!(peerConnection.nodeId() in this._swarms[topic].peers)) {
            console.warn(`Unexpected removePeer for topic (no peer): ${topic}`);
            return;
        }
        delete this._swarms[topic].peers[peerConnection.nodeId()];
    }
    processMessageFromPeer(swarmTopic, peerId, message) {
        this._websocketConnection.sendMessage({
            type: 'messageFromPeer',
            body: {
                swarmTopic,
                peerId,
                message
            }
        });
    }
    _handleMessage(msg) {
        if (msg.type === 'sendMessageToPeer') {
            const swarmTopic = msg.body.swarmTopic;
            const peerId = msg.body.peerId;
            const message = msg.body.message;
            if (peerId in this._swarms[swarmTopic].peers) {
                this._swarms[swarmTopic].peers[peerId].processMessageFromPeer(swarmTopic, this._nodeId, message);
            }
        }
        else if (msg.type === 'sendMessageToSwarm') {
            const swarmTopic = msg.body.swarmTopic;
            const message = msg.body.message;
            for (peerId in this._swarms[swarmTopic].peers) {
                this._swarms[swarmTopic].peers[peerId].processMessageFromPeer(swarmTopic, this._nodeId, message);
            }
        }
    }
    _handleDisconnect() {
        this._onDisconnectCallbacks.forEach(cb => cb());
    }
}

class HubServer {
    constructor() {
        this._onNodeConnectionCallbacks = [];
    }
    onNodeConnection = (cb) => {
        this._onNodeConnectionCallbacks.push(cb);
    }
    async listen(port) {
        ///////////////////////////////////////////////////////////////////////////////
        const websocketServer = new WebSocket.Server({ port });
        let webSocketConnections = {};
        let last_connection_id = 1;
        websocketServer.on('connection', (ws) => {
            let id = last_connection_id + 1;
            let X = new IncomingWebSocketConnection(ws);
            let initialized = false;
            X.onMessage(msg => {
                if (initialized) return;
                if ((msg.type === 'initial') && (msg.body) && (msg.body.nodeId)) {
                    // todo: use signature here to verify nodeId
                    initialized = true;
                    const nodeId = msg.body.nodeId;
                    const nodeConnection = new NodeConnection(nodeId, X);
                    this._onNodeConnectionCallbacks.forEach(cb => {
                        cb(nodeConnection);
                    });
                }
                else {
                    X.disconnect();
                }
            });
        });
        ///////////////////////////////////////////////////////////////////////////////
    }
}

class IncomingWebSocketConnection {
    constructor(webSocket) {
        this._webSocket = webSocket;
        this._onMessageCallbacks = [];
        this._onDisconnectCallbacks = [];

        this._webSocket.on('disconnected', () => {
            this._onDisconnectCallbacks.forEach(cb => cb());
        })

        this._webSocket.on('message', (message) => {
            const msg = JSON.parse(message);
            this._onMessageCallbacks.forEach(cb => {
                cb(msg);
            })
        });

    }
    onMessage(cb) {
        this._onMessageCallbacks.push(cb);
    }
    onDisconnect(cb) {
        this._onDisconnectCallbacks.push(cb);
    }
    sendMessage(msg) {
        this._webSocket.send(JSON.stringify(msg));
    }
    disconnect() {
        this._webSocket.close();
    }
}

export default Hub;