import assert from 'assert';
import RemoteNode from './RemoteNode.js';
import { JSONStringifyDeterministic, sha1sum } from './common/crypto_util.js';
import { randomAlphaString, sleepMsec } from './common/util.js';
import { validateChannelName, validateNodeToNodeMessage, validateNodeId, validateObject, validateNodeData, validatePort, validateSha1Hash } from './schema/index.js';

class RemoteNodeManager {
    constructor(node) {
        this._node = node;
        this._remoteNodes = {}; // by id
        this._halt = false;
        this._localNodeInfo = null;

        this._nodeIdsByTransformedChannelName = {};

        this._onMessageCallbacks = [];
        this._start();
    }
    associateNodeWithTransformedChannelName({nodeId, transformedChannelName}) {
        validateNodeId(nodeId);
        validateSha1Hash(transformedChannelName);

        if (!(transformedChannelName in this._nodeIdsByTransformedChannelName)) {
            this._nodeIdsByTransformedChannelName[transformedChannelName] = {};
        }
        this._nodeIdsByTransformedChannelName[transformedChannelName][nodeId] = {timestamp: new Date()};
    }
    getNodeIdsForTransformedChannelName(transformedChannelName) {
        validateSha1Hash(transformedChannelName);

        const ret = [];
        const x = this._nodeIdsByTransformedChannelName[transformedChannelName];
        if (x) {
            for (let nodeId in x) {
                ret.push(nodeId);
            }
        }
        return ret;
    }
    bootstrapPeerInfo(peerId) {
        validateNodeId(peerId);

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
        validateNodeId(nodeId);

        if (!(nodeId in this._remoteNodes)) return false;
        const X = this._remoteNodes[nodeId];
        return X.hasConnection();
    }
    onMessage(cb) {
        // assert(typeof(cb) === 'function');

        this._onMessageCallbacks.push(cb);
    }
    peerHasConnectionOfType(peerId, {type, direction}) {
        validateNodeId(peerId);
        assert(['websocket', 'udp'].includes(type), 'Invalid connection type');
        if (direction) {
            assert(['incoming', 'outgoing'].includes(direction), 'Invalid connection direction.');
        }

        if (!(peerId in this._remoteNodes)) return false;
        const X = this._remoteNodes[peerId];
        if (type === 'websocket') {
            if (direction === 'incoming') {
                return X.hasIncomingWebsocketConnection();
            }
            else if (direction === 'outgoing') {
                return X.hasOutgoingWebsocketConnection();
            }
            else if (!direction) {
                return ((X.hasIncomingWebsocketConnection()) || (X.hasOutgoingWebsocketConnection()));
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
            else if (!direction) {
                return ((X.hasIncomingUdpConnection()) || (X.hasOutgoingUdpConnection()));
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
        validateChannelName(channelName);

        const peerIds = this.peerIds();
        return peerIds.filter(peerId => (this.remoteNodeInChannel(peerId, channelName)));
    }
    peerIsBootstrap(peerId) {
        validateNodeId(peerId);

        if (!(peerId in this._remoteNodes)) return false;
        return this._remoteNodes[peerId].isBootstrap();
    }
    remoteNodeData(nodeId) {
        validateNodeId(nodeId);

        if (!(nodeId in this._remoteNodes)) return null;
        return this._remoteNodes[nodeId].remoteNodeData();
    }
    remoteNodeHasLocalAddress(nodeId) {
        validateNodeId(nodeId);

        if (!(nodeId in this._remoteNodes)) return false;
        return ((this._remoteNodes[nodeId].remoteNodeLocalAddress()) && (this._remoteNodes[nodeId].remoteNodeLocalPort())) ? true : false;
    }
    remoteNodeIds() {
        return Object.keys(this._remoteNodes);
    }
    remoteNodeIdsForChannel(channelName) {
        validateChannelName(channelName);

        const nodeIds = this.remoteNodeIds();
        return nodeIds.filter(nodeId => ((this.remoteNodeInChannel(nodeId, channelName)) && (!this._remoteNodes[nodeId].isExpired())));
    }
    remoteNodeInAJoinedChannel(nodeId) {
        validateNodeId(nodeId);

        if (!(nodeId in this._remoteNodes)) return false;
        for (let ch in this._node._channels) {
            if (this.remoteNodeInChannel(nodeId, ch)) {
                return true;
            }
        }
        return false;
    }
    remoteNodeInChannel(nodeId, channelName) {
        validateNodeId(nodeId);
        validateChannelName(channelName);

        const transformedChannelName = this._node._gettransformedChannelNameForDiscovery({channelName, nodeId: this._node._nodeId});
        if (transformedChannelName in this._nodeIdsByTransformedChannelName) {
            if (nodeId in this._nodeIdsByTransformedChannelName[transformedChannelName]) {
                return true;
            }
        }
        return false;
    }
    remoteNodeInfo(nodeId) {
        validateNodeId(nodeId);

        if (!(nodeId in this._remoteNodes)) return null;
        return this._remoteNodes[nodeId].remoteNodeInfo();
    }
    sendMessageDirectlyToPeer(peerId, message) {
        validateNodeId(peerId);
        validateNodeToNodeMessage(message);

        assert(peerId in this._remoteNodes, 'sendMessageDirectlyToPeer: no peer');
        const X = this._remoteNodes[peerId];
        assert(X.hasConnection(), 'sendMessageDirectlyToPeer: no connection');
        X.sendMessage(message);
    }
    sendMessageToAllPeers(message) {
        validateNodeToNodeMessage(message);

        const peerIds = this.peerIds();
        for (let peerId of peerIds) {
            this.sendMessageDirectlyToPeer(peerId, message);
        }
    }
    sendMessageToAllPeersNotInJoinedChannels(message) {
        validateNodeToNodeMessage(message);

        const peerIds = this.peerIds();
        for (let peerId of peerIds) {
            if (!this.remoteNodeInAJoinedChannel(peerId)) {
                this.sendMessageDirectlyToPeer(peerId, message);
            }
        }
    }
    setIncomingConnection({nodeId, type, connection}) {
        validateNodeId(nodeId);
        assert(['websocket', 'udp'].includes(type), 'Invalid connection type');

        this._createRemoteNodeIfNeeded(nodeId);
        this._remoteNodes[nodeId].setIncomingConnection({type, connection});
    }
    setOutgoingConnection({nodeId, type, connection}) {
        validateNodeId(nodeId);
        assert(['websocket', 'udp'].includes(type), 'Invalid connection type');

        this._createRemoteNodeIfNeeded(nodeId);
        this._remoteNodes[nodeId].setOutgoingConnection({type, connection});
    }
    setRemoteNodeBootstrapPeerInfo(remoteNodeId, bootstrapPeerInfo) {
        validateNodeId(remoteNodeId);
        if (bootstrapPeerInfo) {
            validateObject(bootstrapPeerInfo, '/BootstrapPeerInfo');
        }

        if (!(remoteNodeId in this._remoteNodes)) return;
        this._remoteNodes[remoteNodeInfo].setBootstrapPeerInfo(bootstrapPeerInfo);
    }
    setLocalNodeInfo(nodeInfo) {
        validateObject(nodeInfo, '/NodeInfo');

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
        validateNodeId(remoteNodeId);
        if (bootstrapPeerInfo) {
            validateObject(bootstrapPeerInfo, '/BootstrapPeerInfo');
        }

        if (!(remoteNodeId in this._remoteNodes)) return;
        this._remoteNodes[remoteNodeId].setBootstrapPeerInfo(bootstrapPeerInfo);
    }
    setRemoteNodeData(nodeId, data) {
        validateNodeId(nodeId);
        validateNodeData(data);

        this._createRemoteNodeIfNeeded(nodeId);
        this._remoteNodes[nodeId].setRemoteNodeData(data);
    }
    setRemoteNodeLocalAddress(nodeId, {localAddress, localPort}) {
        validateNodeId(nodeId);
        validateObject(localAddress, '/Address');
        validatePort(localPort);

        if (nodeId in this._remoteNodes) {
            this._remoteNodes[nodeId].setRemoteNodeLocalAddress({localAddress, localPort});
        }
    }
    _createRemoteNodeIfNeeded(remoteNodeId) {
        validateNodeId(remoteNodeId);

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
    async _startCleanup() {
        while (true) {
            await sleepMsec(10000);
            if (this._halt) return;
            for (let transformedChannelName in this._nodeIdsByTransformedChannelName) {
                const x = this._nodeIdsByTransformedChannelName[transformedChannelName];
                for (let nodeId in x) {
                    const elapsed = (new Date()) - x.timestamp;
                    if (elapsed > 60000) {
                        delete x[nodeId];
                    }
                }
            }
        }
    }
    async _start() {
        this._startCleanup();
    }
}

function cloneObject(obj) {
    if (!obj) return obj;
    return JSON.parse(JSON.stringify(obj));
}

export default RemoteNodeManager;