import crypto from 'crypto';
import hyperswarm from 'hyperswarm';
import JsonSocket from 'json-socket';
import PeerConnection from './PeerConnection.js';
import { randomString, sleepMsec } from './util.js';
import { kacheryInfo } from './kachery.js';

const PROTOCOL_VERSION = 'kachery-p2p-2'

class SwarmConnection {
    constructor(swarmName) {
        this._swarmName = swarmName;
        this._nodeId = randomString(10);
        const key = {
            protocolVersion: PROTOCOL_VERSION,
            swarmName: swarmName
        }
        this._topic = crypto.createHash('sha256')
            .update(JSON.stringify(key))
            .digest()
        this._topicHex = crypto.createHash('sha256')
            .update(JSON.stringify(key))
            .digest('hex')
        this._hyperswarm = null;
        this._peerConnections = {};
        this._requestIdsHandled = {};

        this._start();
    }
    async join() {
        console.info(`joining swarm: ${this._swarmName} (${this._topicHex})`)
        this._hyperswarm = hyperswarm();
        this._hyperswarm.join(this._topic, {
            lookup: true, // find & connect to peers
            announce: true // announce self as a connection target
        })
        // this._hyperswarm.on('peer', peer => {
        //     console.info(`${this._swarmName}: Peer discovered: ${peer.host}:${peer.port}${peer.local ? " (local)" : ""}`)
        // });
        this._hyperswarm.on('peer-rejected', peer => {
            console.info(`${this._swarmName}: Peer rejected: ${peer.host}:${peer.port}${peer.local ? " (local)" : ""}`)
        });
        this._hyperswarm.on('connection', (socket, details) => {
            const jsonSocket = new JsonSocket(socket);
            jsonSocket._socket = socket;
            const peer = details.peer;
            if (peer) {
                console.info(`${this._swarmName}: Connecting to peer: ${peer.host}:${peer.port}${peer.local ? " (local)" : ""}`);
                // const pc = new PeerConnection(peer, jsonSocket);
                // this._peerConnections[peerId] = pc;
            }

            jsonSocket.sendMessage({type: 'initial', from: details.client ? 'server' : 'client', nodeId: this._nodeId, protocolVersion: PROTOCOL_VERSION});
            let receivedInitialMessage = false;
            jsonSocket.on('message', msg => {
                if (receivedInitialMessage) return;
                receivedInitialMessage = true;
                if (msg.type !== 'initial') {
                    console.info('Unexpected initial message from peer connection. Closing.');
                    socket.destroy();
                    return;
                }
                if (msg.protocolVersion !== PROTOCOL_VERSION) {
                    console.info('Incorrect protocol version from peer connection. Closing.');
                    socket.destroy();
                    return;
                }
                if (!validatePeerNodeId(msg.nodeId)) {
                    console.info('Missing or incorrect node ID from peer connection. Closing.');
                    socket.destroy();
                    return;
                }
                if (msg.from !== (details.client ? 'client' : 'server')) {
                    console.info('Unexpected "from" field from peer connection. Closing.');
                    socket.destroy();
                    return;
                }
                if (!this._peerConnections[msg.nodeId]) {
                    const peerConnection = new PeerConnection({swarmName: this._swarmName, peerId: msg.nodeId});
                    this._peerConnections[msg.nodeId] = peerConnection;
                    peerConnection.onMessage((msg2, details) => {
                        this._handleMessageFromPeer(msg.nodeId, msg2);
                    });
                }
                if (details.client) {
                    this._peerConnections[msg.nodeId].setOutgoingSocket(jsonSocket);
                }
                else {
                    this._peerConnections[msg.nodeId].setIncomingSocket(jsonSocket);
                }
                if (details.peer) {
                    console.info(`${this._swarmName}: Connected to peer: ${peer.host}:${peer.port}${peer.local ? " (local)" : ""} (${msg.nodeId})`);
                    this._peerConnections[msg.nodeId].setConnectionInfo({host: details.peer.host, port: details.peer.port, local: details.peer.local});
                }
                socket.on('close', () => {
                    if (msg.nodeId in this._peerConnections) {
                        const peerInfo = this._peerConnections[msg.nodeId].connectionInfo();
                        console.info(`Socket closed for peer connection: ${peerInfo.host}:${peerInfo.port}${peerInfo.local ? " (local)" : ""} (${msg.nodeId})`);
                        this._peerConnections[msg.nodeId].disconnect();
                        delete this._peerConnections[msg.nodeId];
                        this.printInfo();
                    }
                })

                this.printInfo();
            });
        });
        this._hyperswarm.on('disconnection', (socket, info) => {
            const peer = info.peer;
            if (peer) {
                console.info(`${this._swarmName}: Disconnecting from peer: ${peer.host}:${peer.port}${peer.local ? " (local)" : ""}`);
            }
        })
        this.printInfo();
    }
    async leave() {
        this._hyperswarm.leave(this._topic);
    }
    peerIds() {
        return Object.keys(this._peerConnections);
    }
    peerConnection(peerId) {
        return this._peerConnections[peerId];
    }
    numPeers() {
        return Object.keys(this._peerConnections).length;
    }
    disconnectPeer(peerId) {
        if (!(peerId in this._peerConnections)) {
            console.warn(`Cannot disconnect from peer. Not connected: ${peerId}`);
            return;
        }
        this._peerConnections[peerId].disconnect();
        delete this._peerConnections[peerId];
    }
    printInfo() {
        const numPeers = this.numPeers();
        console.info(`${numPeers} ${numPeers === 1 ? "peer" : "peers"}`);
    }
    _handleMessageFromPeer = (peerId, msg) => {
        if (msg.type === 'requestToAllNodes') {
            const requestId = msg.requestId;
            const finalize = () => {
                if (peerId in this._peerConnections) {
                    this._peerConnections[peerId].sendMessage({type: 'requestToAllNodesFinished', requestId});
                }
            }
            if (this._requestIdsHandled[requestId]) {
                finalize();
                return;
            }
            this.makeRequestToAllNodes(msg.requestBody, {requestId, excludeSelf: false}, (nodeIdPath, responseBody) => {
                if (peerId in this._peerConnections) {
                    this._peerConnections[peerId].sendMessage({type: 'requestToAllNodesResponse', nodeIdPath, requestId, responseBody});
                }
            }, () => {
                finalize();
            });
        }
        else if (msg.type === 'requestToNode') {
            const requestId = msg.requestId;
            this.makeRequestToNode(msg.nodeIdPath, msg.requestBody, {requestId}, (responseBody) => {
                this._peerConnections[peerId].sendMessage({type: 'requestToNodeResponse', requestId, responseBody});
            });
        }
    }
    _handleRequestToNode = async (requestBody) => {
        if (requestBody.type === 'findFile') {
            const kacheryPath = requestBody.kacheryPath;
            const info = await kacheryInfo(kacheryPath);
            if (info) {
                return {
                    found: true,
                    info
                };
            }
            else {
                return {
                    found: false
                };
            }
        }
        else if (requestBody.type === 'downloadFile') {
            const kacheryPath = requestBody.kacheryPath;
            const info = await kacheryInfo(kacheryPath);
            if (info) {
                return {
                    found: true,
                    data: 'test-data'
                };
            }
            else {
                return {
                    found: false
                };
            }
        }
        else {
            return {}
        }
    }
    makeRequestToNode = (nodeIdPath, requestBody, opts, onNodeResponse) => {
        const requestId = opts.requestId || randomString(10);
        if (nodeIdPath.length === 0) {
            const asyncHelper = async () => {
                let responseBody = null;
                try {
                    responseBody = await this._handleRequestToNode(requestBody);
                }
                catch(err) {
                    console.warn(`Problem handling request to node: {err.message}`);
                    responseBody = null;
                }
                onNodeResponse(responseBody);
            }
            asyncHelper();
        }
        else if (nodeIdPath[0] in this._peerConnections) {
            this._peerConnections[nodeIdPath[0]].makeRequestToNode(nodeIdPath.slice(1), requestBody, {requestId}, onNodeResponse);
        }
        else {
            throw Error(`No such peer: ${nodeIdPath[0]}`);
        }
    }
    makeRequestToAllNodes = (requestBody, opts, onNodeResponse, onFinished) => {
        const requestId = opts.requestId || randomString(10);
        this._requestIdsHandled[requestId] = true;

        const peerIds = Object.keys(this._peerConnections);
        const peersFinished = {};
        let thisNodeFinished = false;
        const checkFinished = () => {
            let allFinished = true;
            if (!thisNodeFinished) allFinished = false;
            for (let id0 of peerIds) {
                if (!peersFinished[id0]) {
                    allFinished = false;
                }
            }
            if (allFinished) {
                onFinished();
            }
        }

        // this node
        if (!opts.excludeSelf) {
            const asyncHelper = async () => {
                let responseBody = null;
                try {
                    responseBody = await this._handleRequestToNode(requestBody);
                }
                catch(err) {
                    console.warn(`Problem handling request to node: {err.message}`);
                    responseBody = null;
                }
                thisNodeFinished = true;
                onNodeResponse([], responseBody);
                checkFinished();
            }
            asyncHelper();
        }
        else {
            thisNodeFinished = true;
            checkFinished();
        }

        // peer nodes
        peerIds.forEach(peerId => {
            const peerConnection = this._peerConnections[peerId];
            const onPeerNodeResponse = (nodeIdPath, responseBody) => {
                onNodeResponse([peerId, ...nodeIdPath], responseBody);
            }
            const onPeerFinished = () => {
                peersFinished[peerId] = true;
                checkFinished();
            }
            peerConnection.makeRequestToAllNodes(requestBody, {requestId}, onPeerNodeResponse, onPeerFinished);
        });
        checkFinished();
    }

    async findFile(kacheryPath, opts) {
        return new Promise((resolve, reject) => {
            const requestBody = {
                type: 'findFile',
                kacheryPath
            };
            const results = [];
            const onNodeResponse = (nodeIdPath, responseBody) => {
                if (responseBody.found) {
                    results.push({
                        swarmName: this._swarmName,
                        nodeIdPath: nodeIdPath,
                        info: responseBody.info
                    });
                }
            }
            const onFinished = () => {
                resolve({results});
            }
            this.makeRequestToAllNodes(requestBody, {excludeSelf: true}, onNodeResponse, onFinished);
        });
    }
    async downloadFile(nodeIdPath, kacheryPath, opts) {
        return new Promise((resolve, reject) => {
            const onResponse = (responseBody) => {
                resolve(responseBody);
            }
            const requestBody = {
                type: 'downloadFile',
                kacheryPath: kacheryPath
            };
            this.makeRequestToNode(nodeIdPath, requestBody, {}, onResponse);
        });
    }
    async _start() {
        while (true) {
            //maintenance goes here
            await sleepMsec(100);
        }
    }
}

const validatePeerNodeId = (nodeId) => {
    return ((nodeId) && (typeof(nodeId) == 'string') && (nodeId.length <= 256));
}

export default SwarmConnection;