import { getSignature, verifySignature, hexToPublicKey } from '../common/crypto_util.js';
import { sleepMsec, randomAlphaString } from '../common/util.js';
import { getLocalFileInfo } from '../kachery.js';
import { Peer } from './Peer.js'; 
import SmartyNode from './SmartyNode.js';

class Node {
    constructor({
        nodeId,
        keyPair,
        address,
        port,
        udpAddress,
        udpPort,
        feedManager
    }) {
        this._nodeId = nodeId;
        this._keyPair = keyPair;
        this._address = address;
        this._port = port;
        this._udpAddress = udpAddress;
        this._udpPort = udpPort;
        this._feedManager = feedManager;
        this._handledMessages = {};
        this._messageListeners = {}; // listeners for incoming

        this._onProvidingCallbacks = [];
        this._onRequestCallbacks = [];

        this._channels = {}; // by channel name ---- {[channelName]: {nodes: {[nodeId]: {timestamp: ..., nodeInfo: ...}}}}
        this._peers = {}; // by peerId
        
        this._websocketServer = this._initializeServer({type: 'websocket', listenPort: this._port});
        this._udpServer = this._initializeUdpServer({type: 'udp', listenPort: this._udpPort});

        this._smartyNode = new SmartyNode(this);

        this._start();
    }
    nodeInfo() {
        return {
            nodeId: this._nodeId,
            address: this._address,
            port: this._port,
            udpAddress: this._udpAddress,
            udpPort: this._udpPort
        }
    }
    onProviding(cb) {
        this._onProvidingCallbacks.push(cb);
    }
    broadcastMessage({channelName, message}) {
        const body = {
            channelName,
            fromNodeId: this._nodeId,
            message
        };
        const message2 = {
            type: 'broadcast',
            body,
            signature: getSignature(body, this._keyPair)
        };
        this._handleBroadcastMessage({fromNodeId: null, message: message2});
    }
    joinChannel(channelName) {
        if (channelName in this._channels) {
            return;
        }
        this._channels[channelName] = {nodes: {}};
    }
    leaveChannel(channelName) {
        if (channelName in this._channels) {
            delete this._channels[channelName];
            this._cleanupPeers();
        }
    }
    async sendMessageToNode({channelName, toNodeId, route, message}) {
        if (!(channelName in this._channels)) {
            return;
        }
        if (!(toNodeId in this._channels[channelName].nodes)) {
            return;
        }
        if (!route) {
            if (toNodeId in this._peers) {
                this._peers[toNodeId].sendMessage(message);
                return;
            }
            route = await this._smartyNode.which_route_should_i_use_to_send_a_message_to_this_peer({channelName, toNodeId, calculateIfNeeded: true})
        }
        const body = {
            channelName,
            fromNodeId: this._nodeId,
            toNodeId,
            route,
            message
        }
        const message2 = {
            type: 'messageToNode',
            body,
            signature: getSignature(body, this._keyPair)
        };
        this._handleMessageToNode({fromNodeId: null, message: message2});
    }

    // Create a new listener for messages coming from a node
    // if testFunction({fromNodeId, msg}) returns true, it will call
    // the callbacks registered in ret.onMessage(...)
    // Cancel the listener via ret.cancel()
    createMessageListener(testFunction, opts) {
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
    // Listen for requests and send responses
    // Note: it is possible to send more than one response before calling onFinished
    // .onRequest(({fromNodeId, requestBody, onResponse, onError, onFinished})) => {...});
    onRequest(cb) {
        this._onRequestCallbacks.push(cb);
    }
    makeRequestToNode = ({channelName, toNodeId, requestBody, timeout, requestId}) => {
        // Send a request to node
        requestId = opts.requestId || randomAlphaString(10);
        const onResponseCallbacks = [];
        const onErrorCallbacks = [];
        const onFinishedCallbacks = [];
        
        const message = {
            type: 'requestToNode',
            channelName,
            requestId,
            requestBody
        }
        this.sendMessageToNode({channelName, toNodeId, route: null, message});
        const listener = this.createMessageListener(({fromNodeId, message}) => {
            if (fromNodeId !== toNodeId) return false;
            return ((
                (message.type === 'requestToNodeResponse') ||
                (message.type === 'requestToNodeError') ||
                (message.type === 'requestToNodeFinished') ||
                (message.type === 'requestToNodeReceived')
            ) && (message.requestId === requestId));
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
            setTimeout(() => {
                if (!isFinished) {
                    handleError('Timeout while waiting for response.');
                }
            }, opts.timeout);
        }

        listener.onMessage(async ({fromNodeId, message}) => {
            if (message.type === 'requestToNodeReceived') {
                handleReceived();
            }
            else if (message.type === 'requestToNodeResponse') {
                const responseIndex = message.responseIndex;
                bufResponsesByIndex[responseIndex] = message.responseBody;
                while (bufResponsesByIndex[lastResponseIndex + 1]) {
                    handleResponse(bufResponsesByIndex[lastResponseIndex + 1]);
                    delete bufResponsesByIndex[lastResponseIndex + 1];
                    lastResponseIndex ++;
                }
            }
            else if (message.type === 'requestToNodeError') {
                handleError(message.errorString);
            }
            else if (message.type === 'requestToNodeFinished') {
                // wait until we have received the expected number of responses
                while (lastResponseIndex + 1 < message.numResponses) {
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

    _initializeServer({type, listenPort}) {
        let X;
        if (type === 'websocket') {
            X = new WebsocketServer({nodeId: this._nodeId, keyPair: this._keyPair}); // todo
        }
        else if (type === 'udp') {
            throw Error('Not yet implemented');
            // X = new UdpServer({nodeId: this._nodeId, keyPair: this._keyPair}); // todo
        }
        else {
            throw Error(`Unexpected type: ${type}`)
        }

        X.onIncomingConnection(connection => {
            const nodeId = connection.remoteNodeId();
            if (!(nodeId in this._peers)) {
                if (this._nodeIsInOneOfOurChannels(nodeId)) {
                    this._createPeer(nodeId);
                }
            }
            const P = this._peers[nodeId];
            if (P) {
                P.setIncomingConnection({type, connection});
            }
            else {
                connection.disconnect();
            }
        });

        if (listenPort) {
            X.listen(listenPort);
        }
    }

    _handleMessage({fromNodeId, message}) {
        if (message.messageId in this._handledMessages) return;
        this._handledMessages[message.messageId] = true; // todo: fix this memory leak
        if (message.type === 'broadcast') {
            this._handleBroadcastMessage({fromNodeId, message});
        }
        else if (message.type === 'messageToNode') {
            this._handleMessageToNode({fromNodeId, message});
        }
        else if (message.type === 'requestToNode') {
            this._handleRequestToNode({fromNodeId, message});
        }
        else if (message.type === 'seeking') {
            this._handleSeekingMessage({fromNodeId, message});
        }
        else if (message.type === 'providing') {
            this._handleProvidingMessage({fromNodeId, message});
        }
        else if (message.type === 'findChannelNodes') {
            this._handleFindChannelNodes({fromNodeId, message});
        }
        else if (message.type === 'announcing') {
            this._handleAnnouncingMessage({fromNodeId, message});
        }
        else {
            for (let name in this._messageListeners) {
                const x = this._messageListeners[name];
                if (x.testFunction({fromNodeId, message})) {
                    x.onMessageCallbacks.forEach(cb => {
                        try {
                            cb({fromNodeId, message});
                        }
                        catch(err) {
                            // log().warning('Error for message', {fromNodeId, messageType: message.type, error: err.message});
                        }
                    });
                }
            }
        }
    }

    _createPeer(nodeId) {
        if (nodeId in this._peers) return;
        const P = new Peer({peerId: nodeId});
        P.onMessage(message => {
            this._handleMessage({fromNodeId: nodeId, message});
        });
        this._peers[nodeId] = P;
    }

    _handleBroadcastMessage({fromNodeId, message}) {
        const body = message.body;
        const channelName = body.channelName;
        if (!(channelName in this._channels)) return;
        const signature = message.signature;
        if (!verifySignature(body, signature, hexToPublicKey(body.fromNodeId))) {
            // problem verifying signature
            return;
        }
        this._handleMessage({fromNodeId: body.fromNodeId, message: body.message})
        for (let nodeId in this._channels[channelName].nodes) {
            if ((nodeId !== fromNodeId) && (nodeId in this._peers)) {
                const P = this._peers[nodeId];
                P.sendMessage(message);
            }
        }
    }
    _handleMessageToNode({fromNodeId, message}) {
        const body = message.body;
        const channelName = body.channelName;
        if (!(channelName in this._channels)) return;
        const signature = message.signature;
        if (!verifySignature(body, signature, hexToPublicKey(body.fromNodeId))) {
            // problem verifying signature
            return;
        }
        if (body.channelName !== channelName) {
            // problem
            return;
        }
        if (body.toNodeId === this._nodeId) {
            this._handleMessage({channelName, fromNodeId: body.fromNodeId, message: body.message});
            return;
        }
        else if (body.route) {
            let index = body.route.indexOf(this._nodeId);
            if (index < 0) {
                // log().warning(`Unexpected. Node is not found in route`, {nodeId: this._nodeId, route: body.route});
                return;
            }
            if (index === (body.route.length - 1)) {
                // log().warning(`Unexpected. The final node in the route is not the toNodeId.`);
                return;
            }
            const nextNodeId = body.route[index + 1];
            if (!(nextNodeId in this._peers)) {
                //log().warning(`Unexpected. No node that is the next item in route`, {nextNodeId});
                return;
            }
            this._peers[nextNodeId].sendMessage({channelName, message});
        }
    }
    _handleRequestToNode({fromNodeId, message}) {
        const requestId = message.requestId;
        const requestBody = message.requestBody;
        const channelName = requestBody.channelName;
        let numResponses = 0;
        this.sendMessageToNode({channelName, toNodeId: fromNodeId, message: {type: 'requestToNodeReceived', requestId}});
        this._onRequestCallbacks.forEach(cb => {
            cb({
                fromNodeId,
                requestId,
                requestBody,
                onResponse: responseBody => {
                    this.sendMessageToNode({channelName, toNodeId: fromNodeId, message: {type: 'requestToNodeResponse', requestId, responseBody, responseIndex: numResponses}});
                    numResponses ++;
                },
                onError: errorString => {
                    this.sendMessageToNode({channelName, toNodeId: fromNodeId, message: {type: 'requestToNodeError', requestId, errorString}});
                },
                onFinished: () => {
                    this.sendMessageToNode({channelName, toNodeId: fromNodeId, message: {type: 'requestToNodeFinished', numResponses, requestId}});
                }
            })
        });
    }
    async _handleSeekingMessage({fromNodeId, message}) {
        const fileKey = message.fileKey;
        const channelName = message.channelName;
        if (fileKey.sha1) {
            const fileInfo = await getLocalFileInfo({fileKey});
            if (fileInfo) {
                if ('path' in fileInfo)
                    delete fileInfo['path'];
                const message2 = {
                    type: 'providing',
                    fileKey,
                    fileInfo
                };
                this.sendMessageToNode({channelName, toNodeId: fromNodeId, message: message2});
            }
        }
        else if (fileKey.feedId) {
            if (await this._feedManager.hasWriteableFeed({feedId: fileKey.feedId})) {
                const message2 = {
                    type: 'providing',
                    fileKey
                }
                this.sendMessageToNode({channelName, toNodeId: fromNodeId, message: message2});
            }
        }
    }
    async _handleProvidingMessage({fromNodeId, message}) {
        const fileKey = message.fileKey;
        const fileInfo = message.fileInfo || 'null';
        const channelName = message.channelName;
        this._onProvidingCallbacks.forEach(cb => {
            cb({channelName, nodeId: fromNodeId, fileKey, fileInfo});
        });
    }
    async _handleAnnouncingMessage({fromNodeId, message}) {
        const nodeInfo = message.nodeInfo;
        const channelName = message.channelName;
        if (nodeInfo.nodeId !== fromNodeId) {
            // not allowed
            return;
        }
        if (!(channelName in this._channels)) {
            return;
        }

        const CH = this._channels[channelName];
        if (!CH) {
            return;
        }
        if (!(fromNodeId in CH.nodes)) {
            CH.nodes[fromNodeId] = {};
        }
        CH.nodes[fromNodeId].timestamp = new Date();
        CH.nodes[fromNodeId].nodeInfo = nodeInfo;
    }
    _handleFindChannelNodes({fromNodeId, message}) {
        // todo: think about this
        const channelName = message.channelName;
        const nodeInfo = message.nodeInfo;
        if (!this._peers[fromNodeId]) {
            // problem
            return
        }
        if (nodeInfo.nodeId !== fromNodeId) {
            // problem
            return;
        }
        if (!(channelName in this._findChannelNodesLookup)) {
            this._findChannelNodesLookup[channelName] = {nodes: {}};
        }
        const x = this._findChannelNodesLookup[channelName];
        x.nodes[fromNodeId] = {
            timestamp: new Date(),
            nodeInfo
        };
        const nodes = {};
        for (let nodeId in x.nodes) {
            if (nodeId !== fromNodeId) {
                const elapsed = (new Date()) - x.nodes[nodeId];
                if (elapsed < 60000) {
                    nodes[nodeId] = x.nodes[nodeId];
                }
                else {
                    delete x.nodes[nodeId];
                }
            }
        }
        if (Object.keys(nodes).length > 0) {
            this._peers[peerId].sendMessage({
                type: 'findChannelNodesResponse',
                channelName,
                nodes
            });
        }
    }
    _nodeIsInOneOfOurChannels(nodeId) {
        for (let channelName in this._channels) {
            if (nodeId in this._channels[channelName].nodes) {
                return true;
            }
        }
        return false;
    }
    _cleanupPeers() {
        for (let peerId in this._peers) {
            if ((!this._nodeIsInOneOfOurChannels(peerId)) || (!this._peers[peerId].hasConnection())) {
                this._peers[peerId].disconnect();
                delete this._peers[peerId];
            }
        }
    }
    async _startAnnouncingSelf() {
        sleepMsec(1000);
        while (true) {
            for (let channelName in this._channels) {
                const message = {
                    type: 'announcing',
                    nodeInfo: this.nodeInfo(),
                    channelName
                };
                this.broadcastMessage({channelName, message});
            }
            await sleepMsec(10000);
        }
    }
    async _startOutgoingConnections() {
        sleepMsec(1000);
        while (true) {
            for (let channelName in this._channels) {
                const CH = this._channels[channelName];
                for (let nodeId in CH.nodes) {
                    const elapsed = (new Date())  - CH.nodes[nodeId].timestamp;
                    const nodeInfo = CH.nodes[nodeId].nodeInfo;
                    if ((!this._peers[nodeId]) || (!this._peers[nodeId].hasOutgoingWebsocketConnection())) {
                        let C = null;
                        try {
                            C = await this._websocketServer.createOutgoingWebsocketConnection({address: nodeInfo.address, port: nodeInfo.port, remoteNodeId: nodeId});
                        }
                        catch(err) {
                            //
                        }
                        if (C) {
                            if (!this._peers[nodeId]) {
                                this._createPeer(nodeId);
                            }
                            const P = this._peers[nodeId];
                            if (P) {
                                P.setOutgoingConnection({type: 'websocket', connection: C});
                            }
                            else {
                                C.disconnect();
                            }
                        }
                    }
                }
            }
            await sleepMsec(10000);
        }
    }
    async _startCleanupPeers() {
        while (true) {
            this._cleanupPeers();
            await sleepMsec(5000);
        }
    }
    async _start() {
        this._startOutgoingConnections();
        this._startCleanupPeers();
    }
}

export default Node;