import crypto from 'crypto';
import hyperswarm from 'hyperswarm';
import JsonSocket from 'json-socket';
import PeerConnection from './PeerConnection.js';
import { randomString, sleepMsec } from './util.js';

const PROTOCOL_VERSION = 'kachery-p2p-1'

class SwarmConnection {
    constructor(swarmName) {
        this._swarmName = swarmName;
        this._nodeId = randomString(10);
        this._outgoingFileRequests = [];
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
                    this._peerConnections[msg.nodeId] = new PeerConnection({swarmName: this._swarmName, peerId: msg.nodeId});
                    for (let outgoingFileRequest of this._outgoingFileRequests) {
                        this._peerConnections[msg.nodeId].addOutgoingFileRequest(outgoingFileRequest);
                    }
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
                        console.info(`Socket closed for peer connection: ${peerInfo.host}:${peerInfo.port}${peer.local ? " (local)" : ""} (${msg.nodeId})`);
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
                console.info(`${this._swarmName}: Disconnecting from peer: ${peer.host}:${peer.port}${peer.local ? " (local)" : ""} (${id})`);
            }
        })
        this.printInfo();
    }
    leave() {
        this._hyperswarm.leave(this._topic);
    }
    getIncomingFileRequests() {
        let ret = [];
        for (let peerId in this._peerConnections) {
            const x = this._peerConnections[peerId].getIncomingFileRequests();
            for (let a of x) {
                ret.push(a);
            }
        }
        return ret;
    }
    getOutgoingFileRequests() {
        return this._outgoingFileRequests;
    }
    requestFile(kacheryPath, opts) {
        const outgoingFileRequest = {
            requestId: randomString(10),
            kacheryPath: kacheryPath,
            opts: opts,
            status: 'pending',
            offers: []
            // todo: put a cancel() function here
        }
        this._outgoingFileRequests.push(outgoingFileRequest);
        for (let peerId in this._peerConnections) {
            this._peerConnections[peerId].addOutgoingFileRequest(outgoingFileRequest);
        }
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
    async _start() {
        while (true) {
            const keepStatuses1 = {
                pending: true,
                downloading: true
            }
            this._outgoingFileRequests = this._outgoingFileRequests.filter(r => keepStatuses1[r.status]);

            const keepStatuses2 = {
                pending: true,
                "accepted-pending": true,
                "accepted-downloading": true
            }
            for (let outgoingFileRequest of this._outgoingFileRequests) {
                outgoingFileRequest.offers = outgoingFileRequest.offers.filter(o => keepStatuses2[o.status]);
            }
            await sleepMsec(100);
        }
    }
}

const validatePeerNodeId = (nodeId) => {
    return ((nodeId) && (typeof(nodeId) == 'string') && (nodeId.length <= 256));
}

export default SwarmConnection;