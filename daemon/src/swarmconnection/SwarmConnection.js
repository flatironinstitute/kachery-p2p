import PeerDiscoveryEngine from './peerdiscovery/PeerDiscoveryEngine.js';
import PeerConnection from './PeerConnection.js';
import { randomString, sleepMsec } from '../common/util.js';

class SwarmConnection {
    constructor({keyPair, nodeId, swarmName, verbose, nodeInfo}) {
        this._keyPair = keyPair;
        this._nodeId = nodeId;
        this._swarmName = swarmName;
        this._verbose = verbose;
        this._peerDiscoveryEngine = new PeerDiscoveryEngine({
            keyPair, swarmName, nodeId, host: nodeInfo.host, port: nodeInfo.port, verbose
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
        this.broadcastMessage({
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
            id: randomString(),
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
    sendMessageToPeer(peerId, msg, opts) {
        opts = opts || {};
        let _routeToPeerAvoidNodeIds = opts._routeToPeerAvoidNodeIds || [];
        if (!(peerId in this._peerConnections)) {
            console.warn(`Unable to send message ... no peer connection to ${peerId}`);
            return false;
        }
        if (this._verbose >= 100) {
            console.info(`Sending message to peer ${peerId.slice(0, 6)} ${msg.type}`);
        }
        if (this._peerConnections[peerId].hasWebsocketConnection()) {
            this._peerConnections[peerId].sendMessage(msg);
            return true;
        }
        else {
            let avoidNodeIds = _routeToPeerAvoidNodeIds;
            avoidNodeIds.push(this._nodeInfo); // avoid cycles
            const peerIds2 = this._findPeersWithRouteTo(peerId, avoidNodeIds);
            if (peerIds2.length > 0) {
                const peerId2 = peerIds2[0]; // todo: think about which one to use
                this.sendMessageToPeer(peerId2, {
                    type: 'routeToPeer',
                    from: this._nodeInfo,
                    to: peerId,
                    avoidNodeIds: avoidNodeIds,
                    message: msg
                });
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
        const requestId = opts.requestId || randomString(10);
        const onResponseCallbacks = [];
        const onErrorCallbacks = [];
        const onFinishedCallbacks = [];
        // todo: think about doing this without a broadcast
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
        x.onMessage(msg => {
            this._handleMessageFromPeer(peerId, msg);
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
        else if (msg.type === 'routeToPeer') {
            const { from, to, message, avoidNodeIds } = msg;
            if (to === this._nodeInfo) {
                // todo: we need to get an original signature somehow
                this._handleMessageFromPeer(from, message);
            }
            else {
                this.sendMessageToPeer(to, message, {_routeToPeerAvoidNodeIds: avoidNodeIds});
            }
        }
        else if (msg.type === 'leaving') {
            if (fromNodeId in this._peerConnections) {
                this._peerConnections[fromNodeId].destroy(); // todo: implement
                delete this._peerConnections[fromNodeId];
            }
        }
        else {
            for (let id in this._peerMessageListeners) {
                const x = this._peerMessageListeners[id];
                if (x.testFunction(fromNodeId, msg)) {
                    x.onMessageCallbacks.forEach(cb => {cb(fromNodeId, msg);});
                }
            }
        }
    }
    _findPeersWithRouteTo(peerId, avoidNodeIds) {
        let ret = [];
        for (let peerId2 in this._peerConnections) {
            if (avoidNodeIds.indexOf(peerId2) < 0) {
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
            pc.reportRoutes(routes);
        }
    }
    async _start() {
        let lastReportedRoutes = {};
        while (true) {
            if (this._halt) return;
            
            const routes = this._getRoutes();
            if (JSON.stringify(routes) !== JSON.stringify(lastReportedRoutes)) {
                this._updateReportRoutes();
                lastReportedRoutes = routes;
            }

            await sleepMsec(100);
        }
    }
}

export default SwarmConnection;