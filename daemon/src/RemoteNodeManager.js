import assert from 'assert';
import RemoteNode from './RemoteNode.js';
import { JSONStringifyDeterministic, sha1sum } from './common/crypto_util.js';
import { randomAlphaString } from './common/util.js';

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
            if ((this._remoteNodes[nodeId].hasConnection()) && (!this._remoteNodes[nodeId].isExpired())) {
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
    remoteNodeHasLocalAddress(nodeId) {
        if (!(nodeId in this._remoteNodes)) return false;
        return ((this._remoteNodes[nodeId].remoteNodeLocalAddress()) && (this._remoteNodes[nodeId].remoteNodeLocalPort())) ? true : false;
    }
    remoteNodeIds() {
        return Object.keys(this._remoteNodes);
    }
    remoteNodeIdsForChannel(channelName) {
        this._node._validateChannelName(channelName);
        const nodeIds = this.remoteNodeIds();
        return nodeIds.filter(nodeId => ((this.remoteNodeInChannel(nodeId, channelName)) && (!this._remoteNodes[nodeId].isExpired())));
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
    setRemoteNodeLocalAddress(nodeId, {localAddress, localPort}) {
        this._node._validateNodeId(nodeId);
        this._node._validateString(localAddress);
        this._node._validateInteger(localPort);
        if (nodeId in this._remoteNodes) {
            this._remoteNodes[nodeId].setRemoteNodeLocalAddress({localAddress, localPort});
        }
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
                    delete this._remoteNodes[remoteNodeId];
                    X.halt();
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