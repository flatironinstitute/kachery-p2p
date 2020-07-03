import crypto from 'crypto';
import hyperswarm from 'hyperswarm';
import JsonSocket from 'json-socket';
import HPeerConnection from './HPeerConnection.js';
import { randomString, sleepMsec } from './util.js';
import { getSignature, verifySignature, publicKeyToHex, hexToPublicKey } from './crypto_util.js';

const PROTOCOL_VERSION = 'kachery-p2p-3'

class HSwarmConnection {
    constructor({keyPair, nodeId, swarmName, verbose}) {
        this._keyPair = keyPair;
        this._nodeId = nodeId;
        if (this._nodeId !== publicKeyToHex(this._keyPair.publicKey.toString('hex'))) {
            throw Error('public key not consistent with node ID.');
        }
        this._swarmName = swarmName;
        this._verbose = verbose;
        const topicKey = {
            protocolVersion: PROTOCOL_VERSION,
            swarmName: swarmName
        };
        this._topic = crypto.createHash('sha256')
            .update(JSON.stringify(topicKey))
            .digest()
        this._topicHex = crypto.createHash('sha256')
            .update(JSON.stringify(topicKey))
            .digest('hex')
        this._hyperswarm = null;
        this._peerConnections = {};

        this._messageIdsHandled = {};
        this._requestIdsHandled = {};
        this._onMessageCallbacks = [];
        this._onRequestCallbacks = [];
        this._messageListeners = {};

        this.onMessage((fromNodeId, msg) => {
            if (msg.type === 'requestToNode') {
                if (msg.toNodeId === this._nodeId) {
                    const requestId = msg.requestId;
                    if (this._requestIdsHandled[requestId]) return;
                    this._requestIdsHandled[requestId] = true;
                    this.sendMessageToNode(fromNodeId, {type: 'requestToNodeReceived', requestId});
                    this._onRequestCallbacks.forEach(cb => {
                        cb(fromNodeId, msg.requestBody, responseBody => {
                            this.sendMessageToNode(fromNodeId, {type: 'requestToNodeResponse', requestId, responseBody});
                        }, errorString => {
                            this.sendMessageToNode(fromNodeId, {type: 'requestToNodeError', requestId, errorString})
                        }, () => {
                            this.sendMessageToNode(fromNodeId, {type: 'requestToNodeFinished', requestId});
                        })
                    })
                }
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
            console.info(`joining hyperswarm: ${this._swarmName} ${this._topicHex}`)
        }
        this._hyperswarm = hyperswarm({
            forget: {
                // how long to wait before forgetting that a peer
                // has become unresponsive
                unresponsive: 3,
                // how long to wait before fogetting that a peer
                // has been banned
                banned: 3
            },
            multiplex: true
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
            // safe
            let jsonSocket;
            try {
                jsonSocket = new JsonSocket(socket);
            }
            catch(err) {
                console.warn(err);
                console.warn('Problem creating JsonSocket. Closing socket.');
                socket.destroy();
                return;
            }
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
                // safe
                if (receivedInitialMessage) return;
                receivedInitialMessage = true;
                if (msg.type !== 'initial') {
                    console.warn('Unexpected initial message from peer connection. Closing socket.');
                    socket.destroy();
                    return;
                }
                if (msg.protocolVersion !== PROTOCOL_VERSION) {
                    console.warn('Incorrect protocol version from peer connection. Closing socket.');
                    socket.destroy();
                    return;
                }
                if (!validatePeerNodeId(msg.nodeId)) {
                    console.warn(`Node ID: ${msg.nodeID}`);
                    console.warn('Missing or incorrect node ID from peer connection. Closing socket.');
                    socket.destroy();
                    return;
                }
                if (msg.from !== (details.client ? 'client' : 'server')) {
                    console.warn('Unexpected "from" value from peer connection. Closing socket.');
                    socket.destroy();
                    return;
                }
                if (!this._peerConnections[msg.nodeId]) {
                    let peerConnection;
                    try {
                        peerConnection = new HPeerConnection({keyPair: this._keyPair, nodeId: this._nodeId, swarmName: this._swarmName, peerId: msg.nodeId, verbose: this._verbose});
                    }
                    catch(err) {
                        console.warn(err);
                        console.warn('Problem creating peer connection. Closing socket.');
                        socket.destroy();
                        return;
                    }
                    this._peerConnections[msg.nodeId] = peerConnection;
                    peerConnection.onMessage((msg2, details) => {
                        try {
                            this._handleMessageFromPeer(msg.nodeId, msg2);
                        }
                        catch(err) {
                            console.warn(err);
                            console.warn('Problem handling message from peer. Closing socket.');
                            socket.destroy();
                        }
                    });
                }
                if (details.client) {
                    try {
                        this._peerConnections[msg.nodeId].setOutgoingSocket(jsonSocket);
                    }
                    catch(err) {
                        console.warn(err);
                        console.warn('Problem setting outgoing socket. Closing socket.');
                        socket.destroy();
                    }
                }
                else {
                    try {
                        this._peerConnections[msg.nodeId].setIncomingSocket(jsonSocket);
                    }
                    catch(err) {
                        console.warn(err);
                        console.warn('Problem setting incoming socket. Closing socket.');
                        socket.destroy();
                    }
                }
                if (details.peer) {
                    console.info(`${this._swarmName}: Connected to peer: ${peer.host}:${peer.port}${peer.local ? " (local)" : ""} (${msg.nodeId})`);
                    try {
                        this._peerConnections[msg.nodeId].setConnectionInfo({host: details.peer.host, port: details.peer.port, local: details.peer.local});
                    }
                    catch(err) {
                        console.warn(err);
                        console.warn('Problem setting connection info. Closing socket.');
                        socket.destroy();
                    }
                }
                socket.on('error', (err) => {
                    console.warn(err);
                    console.warn('Socket error. Closing socket.');
                    socket.destroy();
                });
                socket.on('close', () => {
                    // safe
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
            // safe
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
    sendMessageToNode(toNodeId, messageBody, opts) {
        const message = {
            type: 'messageToNode',
            toNodeId,
            messageBody
        }
        this.broadcastMessage(message);
    }
    broadcastMessage = (message, opts) => {
        opts = opts || {};
        const messageId = opts.messageId || randomString(10);
        this._messageIdsHandled[messageId] = true;
        const peerIds = Object.keys(this._peerConnections);
        peerIds.forEach(peerId => {
            const body = {
                messageId,
                message,
            };
            const signature = opts.signature || getSignature(body, this._keyPair);
            this._peerConnections[peerId].sendMessage({
                type: 'broadcast',
                fromNodeId: opts.fromNodeId || this._nodeId,
                body: body,
                signature
            });
        })
    }
    onRequest = (cb) => {
        this._onRequestCallbacks.push(cb);
    }
    // returns {onResponse, onError, onFinished, cancel}
    makeRequestToNode = (nodeId, requestBody, opts) => {
        // Send a request to node
        const requestId = opts.requestId || randomString(10);
        const onResponseCallbacks = [];
        const onErrorCallbacks = [];
        const onFinishedCallbacks = [];
        // todo: think about doing this without a broadcast
        const message = {
            type: 'requestToNode',
            toNodeId: nodeId,
            requestId,
            requestBody
        }
        this.broadcastMessage(message);
        const listener = this.createMessageListener((fromNodeId, msg) => {
            if (fromNodeId !== nodeId) return false;
            return ((
                (msg.type === 'requestToNodeResponse') ||
                (msg.type === 'requestToNodeError') ||
                (msg.type === 'requestToNodeFinished') ||
                (msg.type === 'requestToNodeReceived')
            ) && (msg.requestId === requestId));
        });
        let isFinished = false;
        let requestReceived = false;
        let timestampLastResponse = new Date();
        const handleReceived = () => {
            requestReceived = true;
        }
        const handleFinished = () => {
            if (isFinished) return;
            onFinishedCallbacks.forEach(cb => cb());
            isFinished = true;
            listener.cancel();
        }
        const handleResponse = (responseBody) => {
            if (isFinished) return;
            timestampLastResponse = new Date();
            onResponseCallbacks.forEach(cb => cb(responseBody));
        }
        const handleError = (errorString) => {
            if (isFinished) return;
            onErrorCallbacks.forEach(cb => cb(errorString));
            isFinished = true;
            listener.cancel();
        }
        const timer = new Date();
        const checkReceived = () => {
            if (!requestReceived) {
                // Not yet received. Maybe need to wait for peers. Send it again. (Don't worry it will only be processed once)
                this.broadcastMessage(message);
                const elapsed = (new Date()) - timer;
                if (elapsed < 10000) {
                    setTimeout(checkReceived, 500);
                }
            }
        }
        setTimeout(checkReceived, 500);

        if (opts.timeout) {
            const monitorTimeout = async () => {
                while (!isFinished) {
                    const elapsedSinceResponse = (new Date()) - timestampLastResponse;
                    if (elapsedSinceResponse > opts.timeout) {
                        handleError('Timeout while waiting for response.');
                    }
                    await sleepMsec(1000);
                }
            }
            monitorTimeout();
        }

        listener.onMessage((fromNodeId, msg) => {
            if (msg.type === 'requestToNodeReceived') {
                handleReceived();
            }
            else if (msg.type === 'requestToNodeResponse') {
                handleResponse(msg.responseBody);
            }
            else if (msg.type === 'requestToNodeError') {
                handleError(msg.errorString);
            }
            else if (msg.type === 'requestToNodeFinished') {
                handleFinished();
            }
        });
        return {
            onResponse: cb => onResponseCallbacks.push(cb),
            onError: cb => onErrorCallbacks.push(cb),
            onFinished: cb => onFinishedCallbacks.push(cb),
            // todo: think about doing more here - send out a cancel message to node
            cancel: () => {handleFinished(); listener.cancel();}
        }
    }
    onMessage = cb => {
        this._onMessageCallbacks.push(cb);
    }
    createMessageListener = testFunction => {
        const x = {
            id: randomString(),
            testFunction,
            onMessageCallbacks: []
        };
        this._messageListeners[x.id] = x;
        return {
            onMessage: cb => {x.onMessageCallbacks.push(cb);},
            cancel: () => {
                delete this._messageListeners[x.id]
            }
        };
    }
    _handleMessageFromPeer = (peerId, msg) => {
        if (msg.type === 'broadcast') {
            if (!verifySignature(msg.body, msg.signature, hexToPublicKey(Buffer.from(msg.fromNodeId, 'hex')))) {
                console.warn(`Unable to verify message from ${msg.fromNodeId}`);
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
            this.broadcastMessage(msg.body.message, {messageId: messageId, fromNodeId: msg.fromNodeId, signature: msg.signature});
        }
        else if (msg.type === 'keepAlive') {

        }
        else {
            // todo: disconnect from peer
            console.warn(`Unexpected message type: ${msg.type}`);
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

export default HSwarmConnection;