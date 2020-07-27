import PeerDiscoveryEngine from './peerdiscovery/PeerDiscoveryEngine.js';
import PeerConnection from './PeerConnection.js';
import { randomAlphaString, sleepMsec } from '../common/util.js';
import { JSONStringifyDeterministic } from '../common/crypto_util.js'
import { getSignature, hexToPublicKey, verifySignature } from '../common/crypto_util.js';
import SmartySwarmConnection from './SmartySwarmConnection.js';
import { log } from '../common/log.js';

class PeerDiscoveryEngine2 {
    constructor({
        nodeId,
        udpServer,
        swarmName
    }) {
        this._nodeId = nodeId;
        this._udpServer =udpServer;
        this._swarmName = swarmName;
        this._onPeerNodeInfoChangedCallbacks = [];
        this._nodeInfo = null;
        this._udpServer.onLocateSwarmNodesResponse(({swarmName, nodeInfos}) => this._handleLocateSwarmNodesResponse({swarmName, nodeInfos}));
        this._halt = false;
        this._peerNodeInfos = {};
        // this._remoteServerInfo = {
        //     address: '52.9.11.30', // aws
        //     port: 44501
        // };
        this._remoteServerInfo = {
            address: 'localhost',
            port: 3008
        };
        this._start();
    }
    onPeerNodeInfoChanged(cb) {
        this._onPeerNodeInfoChangedCallbacks.push(cb);
    }
    setNodeInfo(nodeInfo) {
        if (JSONStringifyDeterministic(nodeInfo) === JSONStringifyDeterministic(this._nodeInfo || {})) {
            return;
        }
        this._nodeInfo = nodeInfo;
        this._sendAnnounceMessage();
    }
    leave() {
        this._halt = true;
    }
    forgetNode(nodeId) {
        if (nodeId in this._peerNodeInfos) {
            delete this._peerNodeInfos[nodeId];
        }
    }
    _sendAnnounceMessage() {
        if (!this._nodeInfo) return;
        const msg = {
            type: 'announceSwarmNode',
            swarmName: this._swarmName,
            nodeInfo: this._nodeInfo
        };
        this._udpServer._sendMessageToRemote(this._remoteServerInfo, msg);
    }
    _handleLocateSwarmNodesResponse({swarmName, nodeInfos}) {
        if (swarmName === this._swarmName) {
            for (let nodeId in nodeInfos) {
                if (nodeId !== this._nodeId) {
                    const nodeInfo = nodeInfos[nodeId];
                    if ((nodeId in this._peerNodeInfos) && (JSONStringifyDeterministic(nodeInfo) === (JSONStringifyDeterministic(this._peerNodeInfos[nodeId])))) {
                        // no change
                    }
                    else {
                        this._peerNodeInfos[nodeId] = nodeInfo;
                        this._onPeerNodeInfoChangedCallbacks.forEach(cb => {
                            cb({peerId: nodeId, peerNodeInfo: nodeInfos[nodeId]});
                        });
                    }
                }
            }
        }
    }
    async _startLocatingNodesInSwarm() {
        while (true) {
            if (this._halt) return;
            const msg = {
                type: 'locateSwarmNodes',
                swarmName: this._swarmName
            };
            this._udpServer._sendMessageToRemote(this._remoteServerInfo, msg);

            await sleepMsec(5000);
        }
    }
    async _startAnnouncing() {
        while (true) {
            this._sendAnnounceMessage();
            await sleepMsec(60000);
        }
    }
    async _start() {
        this._startLocatingNodesInSwarm();
        this._startAnnouncing();
    }
}

class SwarmConnection {
    constructor({keyPair, nodeId, swarmName, protocolVersion, udpServer, opts}) {
        this._keyPair = keyPair; // the keypair for signing messages (public key is same as node id)
        this._nodeId = nodeId; // The id of the node, determined by the public key in the keypair
        this._nodeInfo = null; // The information to be reported to the other nodes in the swarm -- like the host and port (for listening for websockets)
        this._swarmName = swarmName; // The name of the swarm (related to the channel name)
        this._protocolVersion = protocolVersion;
        this._peerConnections = {}; // Peer connections
        this._peerMessageListeners = {}; // listeners for messages coming in from peers
        this._onPeerRequestCallbacks = []; // callbacks for requests coming in from peers
        this._halt = false;
        this._opts = opts;
        this._lastAnnounceTimestamps = {};
        this._handledBroadcastMessageIds = {};
        this._smarty = new SmartySwarmConnection(this);

        // the discovery engine!
        this._peerDiscoveryEngine = new PeerDiscoveryEngine2({
            nodeId,
            udpServer,
            swarmName
        });
        // Listen for new nodes in the swarm announcing their node info
        this._peerDiscoveryEngine.onPeerNodeInfoChanged(({peerId, peerNodeInfo}) => {
            if (peerId in this._peerConnections) {
                this._peerConnections[peerId].setPeerNodeInfo(peerNodeInfo);
            }
            else {
                this._handleNewPeerAnnounce({peerId, peerNodeInfo});
            }
        });

        // Start the loop
        this._start();
    }
    setNodeInfo(nodeInfo) {
        this._nodeInfo = nodeInfo;
        this._peerDiscoveryEngine.setNodeInfo(nodeInfo);
    }

    // This node id
    nodeId() {
        return this._nodeId;
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
    setIncomingPeerWebsocketConnection(peerId, websocketConnection) {
        // Create the connection if needed
        if (!(peerId in this._peerConnections)) {
            this._createPeerConnection(peerId);
        }

        if (peerId in this._peerConnections) {
            log().info(`SWARM:: Setting incoming websocket connection for peer`, {peerId});
            // set the incoming connection
            this._peerConnections[peerId].setIncomingWebsocketConnection(websocketConnection);
            return;
        }
        else {
            // we couldn't create it (not expected), so let's disconnect
            websocketConnection.disconnect();
        }
    }
    // Set an incoming peer websocket connection
    setIncomingPeerUdpConnection(peerId, udpConnection) {
        // Create the connection if needed
        if (!(peerId in this._peerConnections)) {
            this._createPeerConnection(peerId);
        }

        if (peerId in this._peerConnections) {
            log().info(`SWARM:: Setting incoming udp connection for peer`, {peerId});
            // set the incoming connection
            this._peerConnections[peerId].setIncomingUdpConnection(udpConnection);
            return;
        }
        else {
            // we couldn't create it (not expected), so let's disconnect
            udpConnection.disconnect();
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
        const body = {
            broadcastMessageId: randomAlphaString(10),
            fromNodeId: this._nodeId,
            message: msg
        };
        for (let peerId in this._peerConnections) {
            // do not await... send them simultaneously
            let pc = this._peerConnections[peerId];
            if (pc.hasDirectConnection()) {
                this.sendMessageToPeer(peerId, {
                    type: 'broadcast',
                    body,
                    signature: getSignature(body, this._keyPair)
                });
            }
        }
    }
    // Send a message to a peer
    async sendMessageToPeer(peerId, msg) {
        await this._sendMessageToPeer(peerId, msg);
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

    hasRouteToPeer = async (peerId) => {
        const route = await this._smarty.which_route_should_i_use_to_send_a_message_to_this_peer(peerId, {calculateIfNeeded: false});
        return route ? true : false;
    }
    disconnectPeer = (peerId) => {
        const pc = this.peerConnection(peerId);
        if (!pc) return;
        log().info(`Disconnecting peer`, {peerId});
        pc.disconnect();
        this._peerDiscoveryEngine.forgetNode(peerId);
        delete this._peerConnections[peerId];
    }

    // IMPLEMENTATION /////////////////////////////////////////////////////////////
    async _sendMessageToPeer(peerId, msg) {
        if (!(peerId in this._peerConnections)) {
            log().warning(`Unable to send message ... no connection to peer`, {peerId});
            return false;
        }
        if (msg.type === 'requestToNode') {
            log().info(`Sending request to peer`, {peerId, requestType: msg.requestBody.type});
        }
        else if (msg.type === 'broadcast') {
            log().info(`Broadcasting message to peer`, {peerId, messageType: msg.body.message.type});
        }
        else {
            log().info(`Sending message to peer`, {peerId, messageType: msg.type});
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
        await this._sendSignedMessage(signedMessage);
    }
    async _sendSignedMessage(signedMessage) {
        const {body, signature} = signedMessage;
        const {fromNodeId, toNodeId, message} = body;
        if (signedMessage.route) {
            let index = signedMessage.route.indexOf(this._nodeId);
            if (index < 0) {
                log().warning(`Unexpected. Node is not found in route`, {nodeId: this._nodeId, route: signedMessage.route});
                return false;
            }
            if (index === (signedMessage.route.length - 1)) {
                // I guess it's us!
                if (this._nodeId !== toNodeId) {
                    log().warning(`Unexpected. The final node in the route is not the toNodeId.`);
                    return false;
                }
                this._handleSignedMessageFromPeer({
                    body: signedMessage.body,
                    signature: signedMessage.signature
                });
                return true;
            }
            const nextNodeId = signedMessage.route[index + 1];
            if (!(nextNodeId in this._peerConnections)) {
                log().warning(`Unexpected. No node that is the next item in route`, {nextNodeId});
                return false;
            }
            if (!(this._peerConnections[nextNodeId].hasDirectConnection())) {
                log().warning(`Unexpected. No direct connection to next item in route`, {nextNodeId});
                return false;
            }
            this._peerConnections[nextNodeId].sendSignedMessage(signedMessage);
            return true;
        }
        else if (this._peerConnections[toNodeId].hasDirectConnection()) {
            this._peerConnections[toNodeId].sendSignedMessage(signedMessage);
            return true;
        }
        else {
            const route = await this._smarty.which_route_should_i_use_to_send_a_message_to_this_peer(toNodeId, {calculateIfNeeded: true});
            if (!route) {
                return false;
            }
            const peerId1 = route[1];
            if ((peerId1 in this._peerConnections) && (this._peerConnections[peerId1].hasDirectConnection())) {
                this._peerConnections[peerId1].sendSignedMessage({
                    body: body,
                    signature: signedMessage.signature,
                    route
                });
                return true;
            }
            else return false;
        }
    }
    
    _createPeerConnection(peerId) {
        if (peerId in this._peerConnections) return;
        log().info(`SWARM:: Creating peer connection`, {peerId});
        const x = new PeerConnection({
            keyPair: this._keyPair,
            swarmName: this._swarmName,
            nodeId: this._nodeId,
            peerId,
            protocolVersion: this._protocolVersion
        });
        
        x.onSignedMessage(msg => {
            this._handleSignedMessageFromPeer(msg);
        });
        this._peerConnections[peerId] = x;
        this._lastAnnounceTimestamps[peerId] = new Date();
    }

    _handleNewPeerAnnounce({peerId, peerNodeInfo}) {
        if (peerId in this._peerConnections) {
            log().warning('Unexpected in handleNewPeerAnnounce. Already have peer connection.', {peerId});
            return;
        }
        this._createPeerConnection(peerId);
        this._peerConnections[peerId].setPeerNodeInfo(peerNodeInfo);
        this.sendMessageToPeer(peerId, {
            type: 'announcing',
            nodeInfo: this._nodeInfo
        });
    }
    _handleSignedMessageFromPeer = async (msg) => {
        if (!verifySignature(msg.body, msg.signature, hexToPublicKey(msg.body.fromNodeId))) {
            log().warning(`SWARM:: Unable to verify message`, {fromNodeId: msg.body.fromNodeId});
            return;
        }
        if (msg.route) {
            await this._sendSignedMessage(msg);
            return;
        }
        if (msg.body.toNodeId === this._nodeId) {
            this._handleMessageFromPeer(msg.body.fromNodeId, msg.body.message);
            return;
        }
        log().warning(`Unexpected: message does not have route, and the toNodeId does not equal this one`, {toNodeId: msg.body.toNodeId, nodeId: this._nodeId});
    }
    _handleMessageFromPeer = async (fromNodeId, msg) => {
        log().info(`SWARM:: message from peer`, {fromNodeId, messageType: msg.type});
        if (msg.type === 'requestToNode') {
            if (msg.toNodeId === this._nodeId) {
                const requestId = msg.requestId;
                let numResponses = 0;
                this.sendMessageToPeer(fromNodeId, {type: 'requestToNodeReceived', requestId});
                this._onPeerRequestCallbacks.forEach(cb => {
                    cb({
                        fromNodeId,
                        requestId,
                        requestBody: msg.requestBody,
                        onResponse: responseBody => {
                            this.sendMessageToPeer(fromNodeId, {type: 'requestToNodeResponse', requestId, responseBody, responseIndex: numResponses});
                            numResponses ++;
                        },
                        onError: errorString => {
                            this.sendMessageToPeer(fromNodeId, {type: 'requestToNodeError', requestId, errorString})
                        },
                        onFinished: () => {
                            this.sendMessageToPeer(fromNodeId, {type: 'requestToNodeFinished', numResponses, requestId});
                        }
                    })
                });
            }
        }
        else if (msg.type === 'broadcast') {
            const broadcastMessageId = msg.body.broadcastMessageId;
            const originalFromNodeId = msg.body.fromNodeId;
            const message = msg.body.message;
            const signature = msg.signature;
            if (this._handledBroadcastMessageIds[broadcastMessageId]) {
                return;
            }
            if (!verifySignature(msg.body, signature, hexToPublicKey(originalFromNodeId))) {
                log().warning('Problem verifying signature in broadcast message.', {fromNodeId, originalFromNodeId});
                return;
            }
            // todo: delete these after a period of time
            this._handledBroadcastMessageIds[broadcastMessageId] = true;
            this._handleMessageFromPeer(originalFromNodeId, message);
            for (let peerId in this._peerConnections) {
                if ((peerId !== fromNodeId) && (peerId !== originalFromNodeId)) {
                    // do not await... send them simultaneously
                    let pc = this._peerConnections[peerId];
                    if (pc.hasDirectConnection()) {
                        this.sendMessageToPeer(peerId, {
                            type: 'broadcast',
                            body: msg.body,
                            signature: msg.signature
                        });
                    }
                }
            }
        }
        else if (msg.type === 'announcing') {
            if (!msg.nodeInfo) {
                log().warning('Unexpected. No nodeInfo in announcing message', {fromNodeId});
                return;
            }
            this._lastAnnounceTimestamps[fromNodeId] = new Date();
            // todo: validate the node info
            if (fromNodeId in this._peerConnections) {
                this._peerConnections[fromNodeId].setPeerNodeInfo(msg.nodeInfo);
            }
            else {
                this._handleNewPeerAnnounce({peerId: fromNodeId, peerNodeInfo: msg.nodeInfo});
            }
        }
        else if (msg.type === 'leaving') {
            if (fromNodeId in this._peerConnections) {
                this.disconnectPeer(fromNodeId);
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
                            log().warning('Error for message', {fromNodeId, messageType: msg.type, error: err.message});
                        }
                    });
                }
            }
        }
    }
    _makeRequestToPeer = (nodeId, requestBody, opts) => {
        opts = opts || {};

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
        let lastResponseIndex = -1;
        let bufResponsesByIndex = {};
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

        listener.onMessage(async (fromNodeId, msg) => {
            if (msg.type === 'requestToNodeReceived') {
                handleReceived();
            }
            else if (msg.type === 'requestToNodeResponse') {
                // todo: use msg.responseIndex to sort the order in which we handle the responses (in case they come in a different order)
                const responseIndex = msg.responseIndex;
                bufResponsesByIndex[responseIndex] = msg.responseBody;
                while (bufResponsesByIndex[lastResponseIndex + 1]) {
                    handleResponse(bufResponsesByIndex[lastResponseIndex + 1]);
                    delete bufResponsesByIndex[lastResponseIndex + 1];
                    lastResponseIndex ++;
                }
            }
            else if (msg.type === 'requestToNodeError') {
                handleError(msg.errorString);
            }
            else if (msg.type === 'requestToNodeFinished') {
                // wait until we have received the expected number of responses
                while (lastResponseIndex + 1 < msg.numResponses) {
                    await sleepMsec(10);
                }
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
    async _startAnnouncing() {
        await sleepMsec(100);
        while (true) {
            if (this._halt) return;

            this.sendMessageToAllPeers({
                type: 'announcing',
                nodeInfo: this._nodeInfo
            });

            await sleepMsec(10000);
        }
    }
    async _startCheckingTimeouts() {
        await sleepMsec(100);
        while (true) {
            if (this._halt) return;

            for (let peerId in this._peerConnections) {
                const elapsed = (new Date()) - this._lastAnnounceTimestamps[peerId];
                if (elapsed > 30000) {
                    log().info(`Disconnecting peer due to timeout`, {peerId});
                    this.disconnectPeer(peerId);
                }
            }

            await sleepMsec(1000);
        }
    }
    async _start() {
        this._startAnnouncing();
        this._startCheckingTimeouts();
        await sleepMsec(100);
        while (true) {
            if (this._halt) return;

            // do stuff here

            await sleepMsec(1000);
        }
    }
}

export default SwarmConnection;