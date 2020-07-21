import PeerDiscoveryEngine from './peerdiscovery/PeerDiscoveryEngine.js';
import PeerConnection from './PeerConnection.js';
import { randomAlphaString, sleepMsec } from '../common/util.js';
import { JSONStringifyDeterministic } from '../common/crypto_util.js'
import { getSignature, hexToPublicKey, verifySignature } from '../common/crypto_util.js';

class SwarmConnection {
    constructor({keyPair, nodeId, swarmName, verbose, discoveryVerbose, nodeInfo, protocolVersion}) {
        this._keyPair = keyPair; // the keypair for signing messages (public key is same as node id)
        this._nodeId = nodeId; // The id of the node, determined by the public key in the keypair
        this._swarmName = swarmName; // The name of the swarm (related to the channel name)
        this._verbose = verbose; // Verbosity level
        this._nodeInfo = nodeInfo; // Info about this node, like host and port
        this._peerConnections = {}; // Peer connections
        this._peerMessageListeners = {}; // listeners for messages coming in from peers
        this._onPeerRequestCallbacks = []; // callbacks for requests coming in from peers
        this._halt = false;

        // the discovery engine!
        this._peerDiscoveryEngine = new PeerDiscoveryEngine({
            keyPair,
            swarmName,
            nodeId,
            nodeInfo,
            verbose: discoveryVerbose, // verbosity for just the discovery/hyperswarm part
            protocolVersion // version of the kachery-p2p protocol
        });
        // Listen for new nodes in the swarm announcing their node info
        this._peerDiscoveryEngine.onPeerNodeInfoChanged(({peerId, nodeInfo}) => {
            this._handlePeerAnnounce({peerId, peerNodeInfo});
        });

        // Start the loop
        this._start();
    }

    // Leave this swarm/channel
    async leave() {
        this.sendMessageToAllPeers({
            type: 'leaving'
        });
        this._halt = true;
        this._peerDiscoveryEngine.leave();
    }
    // A sorted list of the peer ids
    peerIds = () => {
        return Object.keys(this._peerConnections).sort();
    }
    // Return a peer connection
    peerConnection = (peerId) => {
        return this._peerConnections[peerId];
    }
    // number of peers
    numPeers = () => {
        return this.peerIds().length;
    }
    // Print some info about this node and peers
    printInfo() {
        const numPeers = this.numPeers();
        console.info(`${numPeers} ${numPeers === 1 ? "peer" : "peers"}`);
    }
    // Set an incoming peer websocket connection
    setIncomingPeerWebsocketConnection(peerId, connection) {
        // Create the connection if needed
        if (!(peerId in this._peerConnections)) {
            this._createPeerConnection(peerId);
        }

        if (peerId in this._peerConnections) {
            if (this._verbose >= 50) {
                console.info(`SWARM:: Setting incoming websocket connection for peer ${peerId}`);
            }
            // set the incoming connection
            this._peerConnections[peerId].setIncomingWebsocketConnection(connection); // todo: implement    
            return;
        }
        else {
            // we couldn't create it, so let's disconnect
            connection.disconnect();
        }
    }
    // Create a new listener for messages coming from a peer
    // if testFunction(fromNodeId, msg) returns true, it will call
    // the callbacks registered in ret.onMessage(...)
    // Cancel the listener via ret.cancel()
    createPeerMessageListener(testFunction, opts) {
        opts = opts || {};
        const x = {
            name: opts.name || randomAlphaString(10),
            testFunction,
            onMessageCallbacks: []
        };
        this._peerMessageListeners[x.name] = x;
        return {
            onMessage: cb => {x.onMessageCallbacks.push(cb);},
            cancel: () => {
                delete this._peerMessageListeners[x.name]
            }
        };
    }
    // Send a message to all peers
    sendMessageToAllPeers(msg) {
        for (let peerId in this._peerConnections) {
            this.sendMessageToPeer(peerId, msg);
        }
    }
    // Send a message to a peer
    sendMessageToPeer(peerId, msg) {
        this._sendMessageToPeer(peerId, msg);
    }
    // Listen for requests and send responses
    // Note: it is possible to send more than one response before calling onFinished
    // .onPeerRequest(({fromNodeId, requestBody, onResponse, onError, onFinished})) => {...});
    onPeerRequest(cb) {
        this._onPeerRequestCallbacks.push(cb);
    }
    // Make a request to a peer and listen for responses
    // returns {onResponse, onError, onFinished, cancel}
    // You can use opts.timeout (milliseconds)
    makeRequestToPeer = (nodeId, requestBody, opts) => {
        return this._makeRequestToPeer(nodeId, requestBody, opts);
    }

    // IMPLEMENTATION /////////////////////////////////////////////////////////////
    _sendMessageToPeer(peerId, msg) {
        if (!(peerId in this._peerConnections)) {
            console.warn(`Unable to send message ... no peer connection to ${peerId}`);
            return false;
        }
        if (this._verbose >= 100) {
            console.info(`Sending message to peer ${peerId.slice(0, 6)} ${msg.type}`);
        }
        // Form the signed message (which may need to get routed through other nodes in the swarm)
        const body = {
            fromNodeId: this._nodeId,
            toNodeId: peerId,
            message: msg
        };
        const signature = getSignature(body, this._keyPair);
        const signedMessage = {
            body,
            avoid: {[this._nodeId]: true}, // Nodes to avoid (case of routing)
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
    

    _createPeerConnection(peerId) {
        if (peerId in this._peerConnections) return;
        if (this._verbose >= 50) {
            console.info(`SWARM:: Creating peer connection: ${peerId}`);
        }
        const x = new PeerConnection({
            keyPair: this._keyPair,
            swarmName: this._swarmName,
            nodeId: this._nodeId,
            peerId,
            verbose: this._verbose
        });
        x.onSignedMessage(msg => {
            this._handleSignedMessageFromPeer(msg);
        });
        this._peerConnections[peerId] = x;
        x.onWebsocketConnection(() => {
            this._updateReportRoutes();
        });
    }

    _handlePeerAnnounce({peerId, peerNodeInfo}) {
        if (!(peerId in this._peerConnections)) {
            this._createPeerConnection(peerId);
        }
        if (peerId in this._peerConnections) {
            this._peerConnections[peerId].setPeerNodeInfo({
                peerNodeInfo
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
                console.info('Forwarding signed message from peer', msg.body.fromNodeId, msg.body.toNodeId, msg.body.message.type, id0);
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
    _makeRequestToPeer = (nodeId, requestBody, opts) => {
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
    async _start() {
        let lastReportedRoutes = {};
        await sleepMsec(100);
        while (true) {
            if (this._halt) return;
            
            const routes = this._getRoutes();
            if (JSONStringifyDeterministic(routes) !== JSONStringifyDeterministic(lastReportedRoutes)) {
                this._updateReportRoutes();
                lastReportedRoutes = routes;
            }

            await sleepMsec(1000);
        }
    }
}

export default SwarmConnection;