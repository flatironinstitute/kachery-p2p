import assert from 'assert';
import RemoteNode from './RemoteNode.js';
import { JSONStringifyDeterministic, sha1sum } from '../common/crypto_util.js';
import { randomAlphaString } from '../common/util.js';

class RemoteNodeManager {
    constructor(node) {
        this._node = node;
        this._remoteNodes = {}; // by id
        this._halt = false;
        this._localNodeInfo = null;

        this._onMessageCallbacks = [];
    }
    bootstrapPeerInfo(peerId) {
        this._node._validateNodeId(peerId);
        assert(peerId in this._remoteNodes, 'bootstrapPeerInfo: no remote node');
        return this._remoteNodes[peerId].bootstrapPeerInfo();
    }
    halt() {
        for (let nodeId in this._remoteNodes) {
            this._remoteNodes[nodeId].halt();
        }
        this._halt = true;
    }
    isPeer(nodeId) {
        this._node._validateNodeId(nodeId);
        if (!(nodeId in this._remoteNodes)) return false;
        const X = this._remoteNodes[nodeId];
        return X.hasConnection();
    }
    onMessage(cb) {
        this._onMessageCallbacks.push(cb);
    }
    peerHasConnectionOfType(peerId, {type, direction}) {
        this._node._validateNodeId(peerId);
        this._node._validateString(type);
        this._node._validateString(direction);
        if (!(peerId in this._remoteNodes)) return false;
        const X = this._remoteNodes[peerId];
        if (type === 'websocket') {
            if (direction === 'incoming') {
                return X.hasIncomingWebsocketConnection();
            }
            else if (direction === 'outgoing') {
                return X.hasOutgoingWebsocketConnection();
            }
            else {
                throw Error('Unexpected direction');
            }
        }
        else if (type === 'udp') {
            if (direction === 'incoming') {
                return X.hasIncomingUdpConnection();
            }
            else if (direction === 'outgoing') {
                return X.hasOutgoingUdpConnection();
            }
            else {
                throw Error('Unexpected direction');
            }
        }
        else {
            throw Error('Unexpected connection type');
        }
    }
    peerIds() {
        const ret = [];
        for (let nodeId in this._remoteNodes) {
            if (this._remoteNodes[nodeId].hasConnection()) {
                ret.push(nodeId);
            }
        }
        return ret;
    }
    peerIdsForChannel(channelName) {
        this._node._validateChannelName(channelName);
        const peerIds = this.peerIds();
        return peerIds.filter(peerId => (this.remoteNodeInChannel(peerId, channelName)));
    }
    peerIsBootstrap(peerId) {
        this._node._validateNodeId(peerId);
        if (!(peerId in this._remoteNodes)) return false;
        return this._remoteNodes[peerId].isBootstrap();
    }
    remoteNodeData(nodeId) {
        this._node._validateNodeId(nodeId);
        if (!(nodeId in this._remoteNodes)) return null;
        return this._remoteNodes[nodeId].remoteNodeData();
    }
    remoteNodeIds() {
        return Object.keys(this._remoteNodes);
    }
    remoteNodeIdsForChannel(channelName) {
        this._node._validateChannelName(channelName);
        const nodeIds = this.remoteNodeIds();
        return nodeIds.filter(nodeId => (this.remoteNodeInChannel(nodeId, channelName)));
    }
    remoteNodeInAJoinedChannel(nodeId) {
        this._node._validateNodeId(nodeId);
        if (!(nodeId in this._remoteNodes)) return false;
        return this._remoteNodes[nodeId].inAJoinedChannel();
    }
    remoteNodeInChannel(nodeId, channelName) {
        this._node._validateNodeId(nodeId);
        this._node._validateChannelName(channelName);
        const channelSha1s = this.remoteNodeChannelSha1s(nodeId);
        if (!channelSha1s) return;
        return (sha1sum(channelName) in channelSha1s);
    }
    remoteNodeInfo(nodeId) {
        this._node._validateNodeId(nodeId);
        if (!(nodeId in this._remoteNodes)) return null;
        return this._remoteNodes[nodeId].remoteNodeInfo();
    }
    remoteNodeChannelSha1s(nodeId) {
        this._node._validateNodeId(nodeId);
        if (!(nodeId in this._remoteNodes)) return null;
        return this._remoteNodes[nodeId].remoteNodeChannelSha1s();
    }
    sendMessageDirectlyToPeer(peerId, message) {
        this._node._validateNodeId(peerId);
        assert(peerId in this._remoteNodes, 'sendMessageDirectlyToPeer: no peer');
        this._node._validateMessage(message);
        const X = this._remoteNodes[peerId];
        assert(X.hasConnection(), 'sendMessageDirectlyToPeer: no connection');
        X.sendMessage(message);
    }
    sendMessageToAllPeers(message) {
        this._node._validateMessage(message);
        const peerIds = this.peerIds();
        for (let peerId of peerIds) {
            this.sendMessageDirectlyToPeer(peerId, message);
        }
    }
    sendMessageToAllPeersNotInJoinedChannels(message) {
        this._node._validateMessage(message);
        const peerIds = this.peerIds();
        for (let peerId of peerIds) {
            if (!this.remoteNodeInAJoinedChannel(peerId)) {
                this.sendMessageDirectlyToPeer(peerId, message);
            }
        }
    }
    setIncomingConnection({nodeId, type, connection}) {
        this._node._validateNodeId(nodeId);
        this._node._validateString(type);
        this._node._validateConnection(connection);
        this._createRemoteNodeIfNeeded(nodeId);
        this._remoteNodes[nodeId].setIncomingConnection({type, connection});
    }
    setOutgoingConnection({nodeId, type, connection}) {
        this._node._validateNodeId(nodeId);
        this._node._validateString(type);
        this._node._validateConnection(connection);
        this._createRemoteNodeIfNeeded(nodeId);
        this._remoteNodes[nodeId].setOutgoingConnection({type, connection});
    }
    setRemoteNodeBootstrapPeerInfo(remoteNodeId, bootstrapPeerInfo) {
        if (!(remoteNodeId in this._remoteNodes)) return;
        if (bootstrapPeerInfo) {
            this._node._validateSimpleObject(bootstrapPeerInfo);
            this._node._validateString(bootstrapPeerInfo.address);
            this._node._validateInteger(bootstrapPeerInfo.port);
        }
        this._remoteNodes[remoteNodeInfo].setBootstrapPeerInfo(bootstrapPeerInfo);
    }
    setLocalNodeInfo(nodeInfo) {
        this._node._validateNodeInfo(nodeInfo);
        if (this._localNodeInfo) {
            if (JSONStringifyDeterministic(nodeInfo) === JSONStringifyDeterministic(this._localNodeInfo))
                return;
        }
        this._localNodeInfo = cloneObject(nodeInfo);
        for (let nodeId in this._remoteNodes) {
            this._remoteNodes[nodeId].setLocalNodeInfo(this._localNodeInfo);
        }
    }
    setRemoteNodeBootstrapPeerInfo(remoteNodeId, bootstrapPeerInfo) {
        if (!(remoteNodeId in this._remoteNodes)) return;
        if (bootstrapPeerInfo) {
            this._node._validateSimpleObject(bootstrapPeerInfo);
            this._node._validateString(bootstrapPeerInfo.address);
            this._node._validateInteger(bootstrapPeerInfo.port);
        }
        this._remoteNodes[remoteNodeId].setBootstrapPeerInfo(bootstrapPeerInfo);
    }
    setRemoteNodeData(nodeId, data) {
        this._node._validateNodeId(nodeId);
        this._validateRemoteNodeData(data);
        this._createRemoteNodeIfNeeded(nodeId);
        this._remoteNodes[nodeId].setRemoteNodeData(data);
    }
    _validateRemoteNodeData(data) {
        this._node._validateSimpleObject(data);
        this._node._validateString(data.signature);
        this._node._validateSimpleObject(data.body);
        this._node._validateSimpleObject(data.body.nodeInfo);
        this._node._validateNodeInfo(data.body.nodeInfo);
        this._node._validateSimpleObject(data.body.channelSha1s);
        assert(data.body.timestamp, 'Missing timestamp in remote node data');
    }
    _createRemoteNodeIfNeeded(remoteNodeId) {
        if (!(remoteNodeId in this._remoteNodes)) {
            const X = new RemoteNode({remoteNodeManager: this, remoteNodeId});
            X.onMessage(message => {
                if (this._remoteNodes[remoteNodeId] === X) {
                    this._onMessageCallbacks.forEach(cb => {
                        cb({fromNodeId: remoteNodeId, message});
                    })
                }
            })
            X.onExpired(() => {
                if (this._remoteNodes[remoteNodeId] === X) {
                    X.halt();
                    delete this._remoteNodes[remoteNodeId];
                }
            });
            X.setLocalNodeInfo(this._localNodeInfo);
            this._remoteNodes[remoteNodeId] = X;
        }
    }
}

function cloneObject(obj) {
    if (!obj) return obj;
    return JSON.parse(JSON.stringify(obj));
}

export default RemoteNodeManager;

// _createPeer(nodeId) {
    //     console.info(`Adding peer: ${nodeId.slice(0, 6)}`);
    //     this._validateNodeId(nodeId);
    //     if (nodeId in this._peers) return;
    //     const P = new Peer({ peerId: nodeId });
    //     P.onMessage(message => {
    //         this._handleMessage({ fromNodeId: nodeId, message });
    //     });
    //     this._peers[nodeId] = P;
    // }

    // _handleReceiveNodeInfo({ data }) {
    //     // called by the two mechanisms for discovering nodes and getting updated nodeInfo data
    //     // This system allows us to trust that the node info is coming from the node itself
    //     this._validateSimpleObject(data, {fields: {
    //         signature: {optional: false, type: 'string'},
    //         body: {optional: false}
    //     }});
    //     assert(data.body.timestamp, 'Missing timestamp');
    //     this._validateNodeInfo(data.body.nodeInfo);
    //     const nodeId = data.body.nodeInfo.nodeId;
    //     this._validateNodeId(nodeId);
    //     if (!verifySignature(data.body, data.signature, hexToPublicKey(data.body.nodeInfo.nodeId))) {
    //         throw new SignatureError({nodeId: data.body.nodeInfo.nodeId, fromNodeId});
    //     }
    //     let okayToReplace = false;
    //     if (nodeId in this._nodeInfoStore) {
    //         const difference = data.body.timestamp - this._nodeInfoStore[nodeId].data.body.timestamp;
    //         if (difference > 0) {
    //             okayToReplace = true;
    //         }
    //     }
    //     else {
    //         okayToReplace = true;
    //     }
    //     if (okayToReplace) {
    //         this._nodeInfoStore[nodeId] = {
    //             internalTimestamp: new Date(), // for deciding when to delete it internal to this component -- don't use remote timestamp because the clock may be out of sync or something - only use remote timestamp for comparing and determining most recent
    //             data
    //         };
    //     }
    // }

    // _announceSelfToAllChannels() {
    //     const selfData = this._createNodeData();
    //     for (let channelName in this._channels) {
    //         const message = {
    //             type: 'announcing',
    //             data: selfData
    //         };
    //         this.broadcastMessage({ channelName, message });
    //     }
    //     for (let peerId in this._peers) {
    //         const P = this._peers[peerId];
    //         if (P.hasConnection()) {
    //             P.sendMessage({
    //                 type: 'announcing',
    //                 data: selfData
    //             });
    //         }
    //     }
    // }

    // async _startOutgoingConnections() {
    //     // start aggressively and then slow down
    //     let delayMsec = 1000;
    //     while (true) {
    //         await sleepMsec(delayMsec);
    //         if (this._halt) return;

    //         const nodeIdsToTry = {};
    //         for (let channelName in this._channels) {
    //             const nodeIdsInChannel = this.getNodeIdsForChannel(channelName);
    //             for (let nodeId of nodeIdsInChannel) {
    //                 let okay = false;
    //                 if (nodeId in this._nodeInfoStore) {
    //                     const elapsed = (new Date()) - this._nodeInfoStore[nodeId].internalTimestamp;
    //                     if (elapsed < 120000) {
    //                         okay = true;
    //                     }
    //                     else {
    //                         delete ch.nodes[nodeId];
    //                     }
    //                 }
    //                 if (okay) {
    //                     nodeIdsToTry[nodeId] = true;
    //                 }
    //             }
    //         }
    //         for (let peerId in this._peers) {
    //             nodeIdsToTry[peerId] = true;
    //         }

    //         for (let nodeId in nodeIdsToTry) {
    //             if (nodeId in this._nodeInfoStore) {
    //                 const elapsed = (new Date()) - this._nodeInfoStore[nodeId].internalTimestamp;
    //                 if (elapsed < 120000) {
    //                     const nodeInfo = this._nodeInfoStore[nodeId].data.body.nodeInfo;
    //                     this._validateNodeInfo(nodeInfo);

    //                     if ((nodeInfo.address) && (nodeInfo.port)) {
    //                         if ((!this._peers[nodeId]) || (!this._peers[nodeId].hasOutgoingWebsocketConnection())) {
    //                             let C = null;
    //                             try {
    //                                 // todo: there is a problem where we may try the connection multiple times if the peer belongs to multiple channels that we are in
    //                                 C = await this._websocketServer.createOutgoingConnection({
    //                                     address: nodeInfo.address,
    //                                     port: nodeInfo.port,
    //                                     remoteNodeId: nodeId
    //                                 });
    //                             }
    //                             catch (err) {
    //                                 // console.warn(`Problem creating outgoing connection to node. ${err.message}`);
    //                             }
    //                             if (C) {
    //                                 if (!this._peers[nodeId]) {
    //                                     this._createPeer(nodeId);
    //                                 }
    //                                 const P = this._peers[nodeId];
    //                                 if (P) {
    //                                     P.setOutgoingConnection({ type: 'websocket', connection: C });
    //                                 }
    //                                 else {
    //                                     console.warn(`Unable to create peer for outgoing connection. Disconnecting.`);
    //                                     C.disconnect();
    //                                 }
    //                             }
    //                         }
    //                     }

    //                     if ((nodeInfo.udpAddress) && (nodeInfo.udpPort) && (this._udpServer)) {
    //                         if ((!this._peers[nodeId]) || (!this._peers[nodeId].hasOutgoingUdpConnection())) {
    //                             // todo: there is a problem where we may try the connection multiple times if the peer belongs to multiple channels that we are in
    //                             let C = null;
    //                             try {
    //                                 C = await this._udpServer.createOutgoingConnection({
    //                                     address: nodeInfo.udpAddress,
    //                                     port: nodeInfo.udpPort,
    //                                     remoteNodeId: nodeId
    //                                 });
    //                             }
    //                             catch(err) {
    //                                 // todo: handle the error smartly
    //                             }
    //                             if (C) {
    //                                 if (!this._peers[nodeId]) {
    //                                     this._createPeer(nodeId);
    //                                 }
    //                                 const P = this._peers[nodeId];
    //                                 if (P) {
    //                                     P.setOutgoingConnection({ type: 'udp', connection: C });
    //                                 }
    //                                 else {
    //                                     console.warn(`Unable to create peer for outgoing connection. Disconnecting.`);
    //                                     C.disconnect();
    //                                 }
    //                             }
    //                         }
    //                     }
    //                 }
    //             }
    //         }
    //         delayMsec *= 2;
    //         if (delayMsec >= 10000) {
    //             delayMsec = 10000;
    //         }
    //     }
    // }