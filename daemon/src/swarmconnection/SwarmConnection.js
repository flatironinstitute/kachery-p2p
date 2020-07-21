import PeerDiscoveryEngine from './peerdiscovery/PeerDiscoveryEngine.js';
import PeerConnection from './PeerConnection.js';
import { randomAlphaString, sleepMsec } from '../common/util.js';
import { getSignature, hexToPublicKey, verifySignature } from '../common/crypto_util.js';

class SwarmConnection {
    constructor({keyPair, nodeId, swarmName, verbose, discoveryVerbose, nodeInfo}) {
        this._keyPair = keyPair;
        this._nodeId = nodeId;
        this._swarmName = swarmName;
        this._verbose = verbose;
        this._peerDiscoveryEngine = new PeerDiscoveryEngine({
            keyPair, swarmName, nodeId, host: nodeInfo.host, port: nodeInfo.port, verbose: discoveryVerbose
        });
        this._nodeInfo = nodeInfo;
        this._peerConnections = {};
        this._peerMessageListeners = {};
        this._onPeerRequestCallbacks = [];
        this._halt = false;

        this._peerDiscoveryEngine.onPeerAnnounce(({peerId, host, port, local}) => {
            this._handlePeerAnnounce({peerId, host, port, local});
        });

        this._start();
    }

    async leave() {
        this.sendMessageToAllPeers({
            type: 'leaving'
        });
        this._halt = true;
        this._peerDiscoveryEngine.leave();
    }
    peerIds = () => {
        return Object.keys(this._peerConnections).sort();
    }
    peerConnection = (peerId) => {
        return this._peerConnections[peerId];
    }
    numPeers = () => {
        return Object.keys(this._peerConnections).length;
    }
    printInfo() {
        const numPeers = this.numPeers();
        console.info(`${numPeers} ${numPeers === 1 ? "peer" : "peers"}`);
    }
    setIncomingPeerWebsocketConnection(peerId, connection) {
        if (!(peerId in this._peerConnections)) {
            this._createPeerConnection(peerId);
        }
        if (peerId in this._peerConnections) {
            if (this._verbose >= 50) {
                console.info(`SWARM:: Setting incoming websocket connection for peer ${peerId}`);
            }
            this._peerConnections[peerId].setIncomingWebsocketConnection(connection); // todo: implement    
            return;
        }
        else {
            connection.disconnect();
        }
    }
    createPeerMessageListener(testFunction) {
        const x = {
            id: randomAlphaString(),
            testFunction,
            onMessageCallbacks: []
        };
        this._peerMessageListeners[x.id] = x;
        return {
            onMessage: cb => {x.onMessageCallbacks.push(cb);},
            cancel: () => {
                delete this._peerMessageListeners[x.id]
            }
        };
    }
    sendMessageToAllPeers(msg) {
        for (let peerId in this._peerConnections) {
            this.sendMessageToPeer(peerId, msg);
        }
    }
    sendMessageToPeer(peerId, msg) {
        if (!(peerId in this._peerConnections)) {
            console.warn(`Unable to send message ... no peer connection to ${peerId}`);
            return false;
        }
        if (this._verbose >= 100) {
            console.info(`Sending message to peer ${peerId.slice(0, 6)} ${msg.type}`);
        }
        const body = {
            fromNodeId: this._nodeId,
            toNodeId: peerId,
            message: msg
        };
        const signature = getSignature(body, this._keyPair);
        const signedMessage = {
            body,
            avoid: {[this._nodeId]: true},
            signature
        }
        this._sendSignedMessage(signedMessage);
    }
    _sendSignedMessage(signedMessage) {
        const {avoid, body, signature} = signedMessage;
        const {fromNodeId, toNodeId, message} = body;
        if (this._peerConnections[toNodeId].hasWebsocketConnection()) {
            this._peerConnections[toNodeId].sendSignedMessage(signedMessage);
            return true;
        }
        else {
            avoid[this._nodeId] = true; // avoid cycles
            const peerIds2 = this._findPeersWithRouteTo(toNodeId, avoid);
            if (peerIds2.length > 0) {
                const peerId2 = peerIds2[0]; // todo: think about which one to use
                this._peerConnections[peerId2].sendSignedMessage(signedMessage);
                return true;
            }
        }
        return false;
    }
    onPeerRequest(cb) {
        this._onPeerRequestCallbacks.push(cb);
    }
    // returns {onResponse, onError, onFinished, cancel}
    makeRequestToPeer = (nodeId, requestBody, opts) => {
        // Send a request to node
        const requestId = opts.requestId || randomAlphaString(10);
        const onResponseCallbacks = [];
        const onErrorCallbacks = [];
        const onFinishedCallbacks = [];
        
        const message = {
            type: 'requestToNode', // todo: make sure we handle this
            toNodeId: nodeId,
            requestId,
            requestBody
        }
        this.sendMessageToPeer(nodeId, message);
        const listener = this.createPeerMessageListener((fromNodeId, msg) => {
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
            requestId,
            onResponse: cb => onResponseCallbacks.push(cb),
            onError: cb => onErrorCallbacks.push(cb),
            onFinished: cb => onFinishedCallbacks.push(cb),
            // todo: think about doing more here - send out a cancel message to node
            cancel: () => {handleFinished(); listener.cancel();}
        }
    }

    _createPeerConnection(peerId) {
        if (peerId in this._peerConnections) return;
        if (this._verbose >= 50) {
            console.info(`SWARM:: Creating peer connection: ${peerId}`);
        }
        const x = new PeerConnection({
            keyPair: this._keyPair,
            swarmName: this._swarmName, nodeId: this._nodeId, peerId, verbose: this._verbose
        });
        x.onSignedMessage(msg => {
            this._handleSignedMessageFromPeer(msg);
        });
        this._peerConnections[peerId] = x;
        x.onWebsocketConnection(() => {
            this._updateReportRoutes();
        });
    }

    _handlePeerAnnounce({peerId, host, port, local}) {
        if (!(peerId in this._peerConnections)) {
            this._createPeerConnection(peerId);
        }
        if (peerId in this._peerConnections) {
            this._peerConnections[peerId].setPeerConnectInfo({
                host, port, local
            });
        }
    }
    _handleSignedMessageFromPeer = async (msg) => {
        if (!verifySignature(msg.body, msg.signature, hexToPublicKey(msg.body.fromNodeId))) {
            console.warn(`SWARM:: Unable to verify message from ${msg.body.fromNodeId}`);
            return;
        }
        if (msg.body.toNodeId === this._nodeId) {
            this._handleMessageFromPeer(msg.body.fromNodeId, msg.body.message);
            return;
        }
        const ids = this._findPeersWithRouteTo(msg.body.toNodeId, msg.avoid);
        let avoid2 = msg.avoid || {};
        avoid2[this._nodeId] = true; // avoid cycles
        if (ids.length > 0) {
            // todo: figure out which to use
            const id0 = ids[0];
            if (this._verbose >= 50) {
                console.info('Forwarding signed message from peer', msg.body.fromNodeId, msg.body.toNodeId, msg.body.type, id0);
            }
            this._peerConnections[id0].sendSignedMessage({
                body: msg.body,
                signature: msg.signature,
                avoid: avoid2
            });
            return;
        }
        console.warn(`Unable to forward message from ${msg.body.fromNodeId} to ${msg.body.toNodeId}`);
    }
    _handleMessageFromPeer = async (fromNodeId, msg) => {
        if (this._verbose >= 100) {
            console.info(`SWARM:: message from peer: ${fromNodeId.slice(0, 6)} ${msg.type}`);
        }
        if (msg.type === 'requestToNode') {
            if (msg.toNodeId === this._nodeId) {
                const requestId = msg.requestId;
                this.sendMessageToPeer(fromNodeId, {type: 'requestToNodeReceived', requestId});
                this._onPeerRequestCallbacks.forEach(cb => {
                    cb({
                        fromNodeId,
                        requestId,
                        requestBody: msg.requestBody,
                        onResponse: responseBody => {
                            this.sendMessageToPeer(fromNodeId, {type: 'requestToNodeResponse', requestId, responseBody});
                        },
                        onError: errorString => {
                            this.sendMessageToPeer(fromNodeId, {type: 'requestToNodeError', requestId, errorString})
                        },
                        onFinished: () => {
                            this.sendMessageToPeer(fromNodeId, {type: 'requestToNodeFinished', requestId});
                        }
                    })
                });
            }
        }
        else if (msg.type === 'leaving') {
            if (fromNodeId in this._peerConnections) {
                this._peerConnections[fromNodeId].disconnect();
                delete this._peerConnections[fromNodeId];
            }
        }
        else if (msg.type === 'reportRoutes') {
            if (fromNodeId in this._peerConnections) {
                this._peerConnections[fromNodeId].setRoutes(msg.routes);
            }
        }
        else {
            for (let id in this._peerMessageListeners) {
                const x = this._peerMessageListeners[id];
                if (x.testFunction(fromNodeId, msg)) {
                    x.onMessageCallbacks.forEach(cb => {
                        try {
                            cb(fromNodeId, msg);
                        }
                        catch(err) {
                            console.warn(err);
                            console.warn('Error for message', fromNodeId, msg.type);
                        }
                    });
                }
            }
        }
    }
    _findPeersWithRouteTo(peerId, avoid) {
        let ret = [];
        for (let peerId2 in this._peerConnections) {
            if (!avoid[peerId2]) {
                const pc = this._peerConnections[peerId2];
                if (pc.hasRouteTo(peerId)) {
                    ret.push(peerId2);
                }
            }
        }
        return ret;
    }
    _getRoutes() {
        let peerIds = this.peerIds();
        let ret = {};
        for (let peerId of peerIds) {
            const pc = this._peerConnections[peerId];
            const routes0 = pc.routes();
            for (let id in routes0) {
                if (id !== this._nodeId) {
                    ret[id] = true;
                }
            }
            if (pc.hasWebsocketConnection()) {
                ret[peerId] = true;
            }
        }
        return ret;
    }
    _updateReportRoutes() {
        let routes = this._getRoutes();
        for (let peerId in this._peerConnections) {
            let pc = this._peerConnections[peerId];
            if (pc.hasWebsocketConnection()) {
                this.sendMessageToPeer(peerId, {
                    type: 'reportRoutes',
                    routes
                });
            }
        }
    }
    async _start() {
        let lastReportedRoutes = {};
        await sleepMsec(100);
        while (true) {
            if (this._halt) return;
            
            const routes = this._getRoutes();
            if (JSON.stringify(routes) !== JSON.stringify(lastReportedRoutes)) {
                this._updateReportRoutes();
                lastReportedRoutes = routes;
            }

            await sleepMsec(1000);
        }
    }
}

export default SwarmConnection;