import crypto from 'crypto';
import hyperswarm from 'hyperswarm';
import JsonSocket from 'json-socket';
import PeerConnection from './PeerConnection.js';
import fs from 'fs';
import Stream from 'stream';
import { randomString, sleepMsec } from './util.js';
import { kacheryInfo } from './kachery.js';

const PROTOCOL_VERSION = 'kachery-p2p-2'

class SwarmConnection {
    constructor(swarmName, {verbose}) {
        this._swarmName = swarmName;
        this._nodeId = randomString(10);
        this._verbose = verbose;
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
        if (this._verbose >= 1) {
            console.info(`joining swarm: ${this._swarmName} (${this._topicHex})`)
        }
        this._hyperswarm = hyperswarm({
            forget: {
                // how long to wait before forgetting that a peer
                // has become unresponsive
                unresponsive: 3,
                // how long to wait before fogetting that a peer
                // has been banned
                banned: 3
            }
        });
        this._hyperswarm.join(this._topic, {
            lookup: true, // find & connect to peers
            announce: true // announce self as a connection target
        })
        // this._hyperswarm.on('peer', peer => {
        //     console.info(`${this._swarmName}: Peer discovered: ${peer.host}:${peer.port}${peer.local ? " (local)" : ""}`)
        // });
        this._hyperswarm.on('peer-rejected', peer => {
            if (this._verbose >= 0) {
                console.info(`${this._swarmName}: Peer rejected: ${peer.host}:${peer.port}${peer.local ? " (local)" : ""}`)
            }
        });
        this._hyperswarm.on('connection', (socket, details) => {
            const jsonSocket = new JsonSocket(socket);
            jsonSocket._socket = socket;
            const peer = details.peer;
            if (peer) {
                if (this._verbose >= 0) {
                    console.info(`${this._swarmName}: Connecting to peer: ${peer.host}:${peer.port}${peer.local ? " (local)" : ""}`);
                }
                // const pc = new PeerConnection(peer, jsonSocket);
                // this._peerConnections[peerId] = pc;
            }

            jsonSocket.sendMessage({type: 'initial', from: details.client ? 'server' : 'client', nodeId: this._nodeId, protocolVersion: PROTOCOL_VERSION});
            let receivedInitialMessage = false;
            jsonSocket.on('message', msg => {
                if (receivedInitialMessage) return;
                receivedInitialMessage = true;
                if (msg.type !== 'initial') {
                    console.warn('Unexpected initial message from peer connection. Closing.');
                    socket.destroy();
                    return;
                }
                if (msg.protocolVersion !== PROTOCOL_VERSION) {
                    console.warn('Incorrect protocol version from peer connection. Closing.');
                    socket.destroy();
                    return;
                }
                if (!validatePeerNodeId(msg.nodeId)) {
                    console.warn('Missing or incorrect node ID from peer connection. Closing.');
                    socket.destroy();
                    return;
                }
                if (msg.from !== (details.client ? 'client' : 'server')) {
                    console.warn('Unexpected "from" field from peer connection. Closing.');
                    socket.destroy();
                    return;
                }
                if (!this._peerConnections[msg.nodeId]) {
                    const peerConnection = new PeerConnection({swarmName: this._swarmName, peerId: msg.nodeId, verbose: this._verbose});
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
                if (this._verbose >= 0) {
                    console.info(`${this._swarmName}: Disconnecting from peer: ${peer.host}:${peer.port}${peer.local ? " (local)" : ""}`);
                }
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
        if (this._verbose >= 2) {
            console.info(`handleMessageFromPeer: ${this._swarmName} ${peerId} ${msg.type}`);
        }
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
                if (peerId in this._peerConnections) {
                    this._peerConnections[peerId].sendMessage({type: 'requestToNodeResponse', requestId, responseBody});
                }
            }, () => {
                if (peerId in this._peerConnections) {
                    this._peerConnections[peerId].sendMessage({type: 'requestToNodeFinished', requestId})
                }
            });
        }
    }
    _handleRequestToNode = (requestBody, onResponse, onFinished) => {
        if (this._verbose >= 1) {
            console.info(`handleRequestToNode: ${this._swarmName} ${requestBody.type}`);
        }
        (async () => {
            if (requestBody.type === 'findFile') {
                const kacheryPath = requestBody.kacheryPath;
                const info = await kacheryInfo(kacheryPath);
                if (this._verbose >= 2) {
                    console.info(`Result of findFile for ${kacheryPath}: ${JSON.stringify(info || 'null')}`);
                }
                if (info) {
                    if ('path' in info)
                        delete info['path'];
                    onResponse({
                        found: true,
                        info
                    });
                    onFinished();
                }
                else {
                    onResponse({
                        found: false
                    });
                    onFinished();
                }
            }
            else if (requestBody.type === 'downloadFile') {
                const kacheryPath = requestBody.kacheryPath;
                const info = await kacheryInfo(kacheryPath);
                if (info) {
                    const fileSystemPath = info['path'];
                    const readStream = fs.createReadStream(fileSystemPath);
                    readStream.on('data', data => {
                        onResponse({
                            data_b64: data.toString('base64')
                        });
                    });
                    readStream.on('end', () => {
                        onFinished();
                    })
                }
                else {
                    onResponse({
                        found: false
                    });
                    onFinished();
                }
            }
            else {
                onResponse({});
                onFinished();
            }
        })();
    }
    makeRequestToNode = (nodeIdPath, requestBody, opts, onResponse, onFinished) => {
        if (this._verbose >= 1) {
            console.info(`makeRequestToNode: ${this._swarmName} ${nodeIdPath.join(',')} ${requestBody.type}`);
        }
        const requestId = opts.requestId || randomString(10);
        if (nodeIdPath.length === 0) {
            this._handleRequestToNode(requestBody, onResponse, onFinished);
        }
        else if (nodeIdPath[0] in this._peerConnections) {
            this._peerConnections[nodeIdPath[0]].makeRequestToNode(nodeIdPath.slice(1), requestBody, {requestId}, onResponse, onFinished);
        }
        else {
            throw Error(`No such peer: ${nodeIdPath[0]}`);
        }
    }
    makeRequestToAllNodes = (requestBody, opts, onNodeResponse, onFinished) => {
        if (this._verbose >= 1) {
            console.info(`makeRequestToAllNodes: ${this._swarmName} ${requestBody.type}`);
        }
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
            this._handleRequestToNode(requestBody, (responseBody) => {
                onNodeResponse([], responseBody);
            }, () => {
                thisNodeFinished = true;
                checkFinished();
            });
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
    // returns a stream
    downloadFile(nodeIdPath, kacheryPath, opts, onData) {
        const requestBody = {
            type: 'downloadFile',
            kacheryPath: kacheryPath
        };
        let finished = false;
        let sha1_sum = crypto.createHash('sha1');
        this.makeRequestToNode(nodeIdPath, requestBody, {}, (responseBody) => {
            if (!finished) {
                const buf = Buffer.from(responseBody.data_b64, 'base64');
                sha1_sum.update(buf);
                // todo: implement this properly so we don't overflow the stream
                stream.push(buf);
            }
        }, () => {
            finished = true;
            let sha1_hash = sha1_sum.digest('hex');;
            // todo: check hash to see if it is equal to the expected based on kacheryPath
            stream.push(null);
        });
        const stream = new Stream.Readable({
            read(size) {
                // todo: implement this properly so we don't overflow the stream
            }
        });

        return stream;
    }
    async _start() {
        while (true) {
            //maintenance goes here
            const peerIds = this.peerIds();
            for (let peerId of peerIds) {
                const peerConnection = this._peerConnections[peerId];
                if (peerConnection.elapsedTimeSecSinceLastIncomingMessage() > 10) {
                    this.disconnectPeer(peerId);
                }
                if (peerConnection.elapsedTimeSecSinceLastOutgoingMessage() > 5) {
                    peerConnection.sendMessage({type: 'keepAlive'});
                }
            }

            await sleepMsec(100);
        }
    }
}

const validatePeerNodeId = (nodeId) => {
    return ((nodeId) && (typeof(nodeId) == 'string') && (nodeId.length <= 256));
}

export default SwarmConnection;