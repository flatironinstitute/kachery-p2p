import crypto from 'crypto';
import HyperswarmPeerConnection from './HyperswarmPeerConnection.js';
import { randomAlphaString, sleepMsec } from '../../common/util.js';
import { getSignature, verifySignature, publicKeyToHex, hexToPublicKey, JSONStringifyDeterministic } from '../../common/crypto_util.js';
import AbstractHyperswarm from './AbstractHyperswarm.js';

class HyperswarmConnection {
    constructor({keyPair, nodeId, swarmName, protocolVersion, verbose}) {
        this._keyPair = keyPair;
        this._nodeId = nodeId;
        if (this._nodeId !== publicKeyToHex(this._keyPair.publicKey.toString('hex'))) {
            throw Error('public key not consistent with node ID.');
        }
        this._swarmName = swarmName;
        this._verbose = verbose;
        const topicKey = {
            protocolVersion: protocolVersion,
            swarmName: swarmName
        };
        this._topic = crypto.createHash('sha256')
            .update(JSONStringifyDeterministic(topicKey))
            .digest()
        this._topicHex = crypto.createHash('sha256')
            .update(JSONStringifyDeterministic(topicKey))
            .digest('hex');
        this._hyperswarm = null;
        this._peerConnections = {};

        this._messageIdsHandled = {};
        this._onMessageCallbacks = [];
        this._onPeerConnectionCallbacks = [];
        this._messageListeners = {};

        this.onMessage((fromNodeId, msg) => {
            if (!this._peerConnections[fromNodeId]) {
                if (this._verbose >= 1) {
                    console.warn(`HYPERSWARM:: Got message, but no peer connection found: ${fromNodeId}`);
                }
                return;
            }
            else if (msg.type === 'messageToNode') {
                if (msg.toNodeId === this._nodeId) {
                    this._onMessageCallbacks.forEach(cb => {
                        cb(fromNodeId, msg.messageBody);
                    })
                }
            }
            else {
                for (let id in this._messageListeners) {
                    const x = this._messageListeners[id];
                    if (x.testFunction(fromNodeId, msg)) {
                        x.onMessageCallbacks.forEach(cb => {cb(fromNodeId, msg);});
                    }
                }
            }
        })

        this._start();
    }
    async join() {
        if (this._verbose >= 1) {
            console.info(`HYPERSWARM:: joining hyperswarm: ${this._swarmName} ${this._topicHex}`)
        }
        this._hyperswarm = new AbstractHyperswarm(this._topic);
        
        this._hyperswarm.onConnection((jsonSocket, socket, details) => {
            this._handleNewConnection({jsonSocket, socket, details});
        });
    }
    peerIsLocal(peerId) {
        if (peerId in this._peerConnections) {
            return this._peerConnections[peerId].peerIsLocal();
        }
        return null;
    }
    _handleNewConnection({jsonSocket, socket, details}) {
        // todo: provide an AbstractHyperswarmConnection here
        // *** then implement the hub connection
        jsonSocket.sendMessage({
            type: 'initial',
            from: details.client ? 'server' : 'client',
            nodeId: this._nodeId,
            protocolVersion: PROTOCOL_VERSION
        });
        let receivedInitialMessage = false;
        jsonSocket.on('message', msg => {
            // safe
            if (receivedInitialMessage) return;
            receivedInitialMessage = true;
            if (msg.type !== 'initial') {
                if (this._verbose >= 1) {
                    console.warn('HYPERSWARM:: Unexpected initial message from peer connection. Closing socket.');
                }
                socket.destroy();
                return;
            }
            if (msg.protocolVersion !== PROTOCOL_VERSION) {
                if (this._verbose >= 1) {
                    console.warn('HYPERSWARM:: Incorrect protocol version from peer connection. Closing socket.');
                }
                socket.destroy();
                return;
            }
            if (!validatePeerNodeId(msg.nodeId)) {
                if (this._verbose >= 1) {
                    console.warn(`HYPERSWARM:: Node ID: ${msg.nodeID}`);
                    console.warn('HYPERSWARM:: Missing or incorrect node ID from peer connection. Closing socket.');
                }
                socket.destroy();
                return;
            }
            if (msg.from !== (details.client ? 'client' : 'server')) {
                if (this._verbose >= 1) {
                    console.warn('HYPERSWARM:: Unexpected "from" value from peer connection. Closing socket.');
                }
                socket.destroy();
                return;
            }
            if (!this._peerConnections[msg.nodeId]) {
                let peerConnection;
                try {
                    peerConnection = new HyperswarmPeerConnection({
                        keyPair: this._keyPair,
                        nodeId: this._nodeId,
                        swarmName: this._swarmName,
                        peerId: msg.nodeId,
                        verbose: this._verbose
                    });
                }
                catch(err) {
                    if (this._verbose >= 1) {
                        console.warn(err);
                        console.warn('HYPERSWARM:: Problem creating peer connection. Closing socket.');
                    }
                    socket.destroy();
                    return;
                }
                this._peerConnections[msg.nodeId] = peerConnection;
                this._onPeerConnectionCallbacks.forEach(cb => cb(msg.nodeId));
                peerConnection.onMessage((msg2, details) => {
                    try {
                        this._handleMessageFromPeer(msg.nodeId, msg2);
                    }
                    catch(err) {
                        if (this._verbose >= 1) {
                            console.warn(err);
                            console.warn('HYPERSWARM:: Problem handling message from peer. Closing socket.');
                        }
                        socket.destroy();
                    }
                });
                
            }
            if (details.client) {
                try {
                    this._peerConnections[msg.nodeId].setOutgoingSocket(jsonSocket);
                }
                catch(err) {
                    if (this._verbose >= 1) {
                        console.warn(err);
                        console.warn('HYPERSWARM:: Problem setting outgoing socket. Closing socket.');
                    }
                    socket.destroy();
                }
            }
            else {
                try {
                    this._peerConnections[msg.nodeId].setIncomingSocket(jsonSocket);
                }
                catch(err) {
                    if (this._verbose >= 1) {
                        console.warn(err);
                        console.warn('HYPERSWARM:: Problem setting incoming socket. Closing socket.');
                    }
                    socket.destroy();
                }
            }
            if (details.peer) {
                const peer = details.peer;
                if (this._verbose >= 1) {
                    console.info(`HYPERSWARM:: ${this._swarmName}: Connected to peer: ${peer.host}:${peer.port}${peer.local ? " (local)" : ""} (${msg.nodeId})`);
                }
                try {
                    this._peerConnections[msg.nodeId].setConnectionInfo({
                        host: details.peer.host,
                        port: details.peer.port,
                        local: details.peer.local
                    });
                }
                catch(err) {
                    if (this._verbose >= 1) {
                        console.warn(err);
                        console.warn('HYPERSWARM:: Problem setting connection info. Closing socket.');
                    }
                    socket.destroy();
                }
                this.printInfo();
            }
            socket.on('error', (err) => {
                if (this._verbose >= 1) {
                    console.warn(err);
                    console.warn('HYPERSWARM:: Socket error. Closing socket.');
                }
                socket.destroy();
            });
            socket.on('close', () => {
                // safe
                if (msg.nodeId in this._peerConnections) {
                    const peerInfo = this._peerConnections[msg.nodeId].connectionInfo();
                    if (this._verbose >= 1) {
                        console.info(`HYPERSWARM:: Socket closed for peer connection: ${peerInfo.host}:${peerInfo.port}${peerInfo.local ? " (local)" : ""} (${msg.nodeId})`);
                    }
                    this._peerConnections[msg.nodeId].disconnect();
                    delete this._peerConnections[msg.nodeId];
                    this.printInfo();
                }
            })
        });
    }
    async leave() {
        this._hyperswarm.leave();
    }
    onPeerConnection(cb) {
        this._onPeerConnectionCallbacks.push(cb);
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
            if (this._verbose >= 1) {
                console.warn(`HYPERSWARM:: Cannot disconnect from peer. Not connected: ${peerId}`);
            }
            return;
        }
        this._peerConnections[peerId].disconnect();
        delete this._peerConnections[peerId];
    }
    printInfo() {
        const numPeers = this.numPeers();
        console.info(`HYPERSWARM:: ${numPeers} ${numPeers === 1 ? "peer" : "peers"}`);
    }
    sendMessageToNode(toNodeId, messageBody, opts) {
        const message = {
            type: 'messageToNode',
            toNodeId,
            messageBody
        }
        if (toNodeId in this._peerConnections) {
            const body = {
                messageId: randomAlphaString(10),
                message
            };
            const signature = getSignature(body, this._keyPair);
            this._peerConnections[toNodeId].sendMessage({
                type: 'directToPeer',
                fromNodeId: this._nodeId,
                body,
                signature
            })
        }
        else {
            this.broadcastMessage(message);
        }
    }
    broadcastMessage = (message, opts) => {
        opts = opts || {};
        const excludeNodeIds = opts.excludeNodeIds || {};
        const messageId = opts.messageId || randomAlphaString(10);
        this._messageIdsHandled[messageId] = true;
        const peerIds = Object.keys(this._peerConnections);
        peerIds.filter(peerId => (!excludeNodeIds[peerId])).forEach(peerId => {
            const body = {
                messageId,
                message,
            };
            const signature = opts.signature || getSignature(body, this._keyPair);
            this._peerConnections[peerId].sendMessage({
                type: 'broadcast',
                fromNodeId: opts.fromNodeId || this._nodeId,
                body,
                signature,
                excludeNodeIds: {...excludeNodeIds, [this._nodeId]: true}
            });
        })
    }
    onMessage = cb => {
        this._onMessageCallbacks.push(cb);
    }
    createPeerMessageListener = (testFunction, opts) => {
        opts = opts || {};
        const x = {
            name: opts.name || randomAlphaString(10),
            testFunction,
            onMessageCallbacks: []
        };
        this._messageListeners[x.name] = x;
        return {
            onMessage: cb => {x.onMessageCallbacks.push(cb);},
            cancel: () => {
                delete this._messageListeners[x.name]
            }
        };
    }
    _handleMessageFromPeer = (peerId, msg) => {
        if ((msg.type === 'broadcast') || (msg.type === 'directToPeer')) {
            if (!verifySignature(msg.body, msg.signature, hexToPublicKey(msg.fromNodeId))) {
                if (this._verbose >= 1) {
                    console.warn(`HYPERSWARM:: Unable to verify message from ${msg.fromNodeId}`);
                }
                return;
            }
            const messageId = msg.body.messageId;
            if (messageId in this._messageIdsHandled) {
                return;
            }
            this._messageIdsHandled[messageId] = true;
            for (let cb of this._onMessageCallbacks) {
                cb(msg.fromNodeId, msg.body.message);
            }
            if (msg.type === 'broadcast') {
                const excludeNodeIds = msg.excludeNodeIds;
                this.broadcastMessage(msg.body.message, {messageId, fromNodeId: msg.fromNodeId, signature: msg.signature, excludeNodeIds});
            }
        }
        else if (msg.type === 'keepAlive') {

        }
        else {
            // todo: disconnect from peer
            if (this._verbose >= 1) {
                console.warn(`HYPERSWARM:: Unexpected message type: ${msg.type}`);
            }
        }
    }

    async _start() {
        while (true) {
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

// safe
const validatePeerNodeId = (nodeId) => {
    return ((nodeId) && (typeof(nodeId) == 'string') && (nodeId.length <= 256));
}

export default HyperswarmConnection;