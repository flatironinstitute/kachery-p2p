import { verifySignature } from './common/crypto_util';
import { Address, ChannelInfo, ChannelName, ChannelNodeInfo, DurationMsec, durationMsecToNumber, errorMessage, jsonObjectsMatch, NodeId, nodeIdToPublicKey } from './interfaces/core';
import { AnnounceRequestData, AnnounceResponseData, NodeToNodeRequestData, NodeToNodeResponseData } from './interfaces/NodeToNodeRequest';
import KacheryP2PNode from './KacheryP2PNode';
import RemoteNode, { SendRequestMethod } from './RemoteNode';

class RemoteNodeManager {
    #node: KacheryP2PNode
    #remoteNodes = new Map<NodeId, RemoteNode>()
    #onNodeChannelAddedCallbacks: ((remoteNodeId: NodeId, channelName: ChannelName) => void)[] = []
    #onBootstrapNodeAddedCallbacks: ((bootstrapNodeId: NodeId) => void)[] = []
    constructor(node: KacheryP2PNode) {
        this.#node = node;
    }
    async handleAnnounceRequest({fromNodeId, requestData, localUdpAddress}: {fromNodeId: NodeId, requestData: AnnounceRequestData, localUdpAddress: Address | null}): Promise<AnnounceResponseData> {
        // only handle this if we belong to this channel or we are a bootstrap node
        if (!this.#node.isBootstrapNode()) {
            if (!this.#node.channelNames().includes(requestData.channelNodeInfo.body.channelName)) {
                return {
                    requestType: 'announce',
                    success: false,
                    errorMessage: errorMessage('Not a bootstrap and not a member of this channel.')
                };
            }
        }
        const { channelNodeInfo } = requestData;
        this.setChannelNodeInfo(channelNodeInfo);
        if (localUdpAddress) {
            const n = this.#remoteNodes.get(channelNodeInfo.body.nodeId)
            if (n) {
                n.setLocalUdpAddress(localUdpAddress)
            }
        }
        return {
            requestType: 'announce',
            success: true,
            errorMessage: null
        }
    }
    setChannelNodeInfo(channelNodeInfo: ChannelNodeInfo) {
        const { body, signature } = channelNodeInfo;
        if (!verifySignature(body, signature, nodeIdToPublicKey(channelNodeInfo.body.nodeId))) {
            throw Error('Invalid signature for channelNodeInfo.');
        }
        if (body.nodeId === this.#node.nodeId()) {
            throw Error('Cannot set channel node info for self')
        }
        if (!this.#remoteNodes.has(body.nodeId)) {
            this.#remoteNodes.set(body.nodeId, new RemoteNode(this.#node, body.nodeId));
        }
        const n = this.#remoteNodes.get(body.nodeId);
        if (!n) throw Error('Unexpected');
        const newChannel = (!n.getChannelNames().includes(channelNodeInfo.body.channelName));
        n.setChannelNodeInfoIfMoreRecent(channelNodeInfo.body.channelName, channelNodeInfo);
        if (newChannel) {
            this.#onNodeChannelAddedCallbacks.forEach(cb => {
                cb(n.remoteNodeId(), channelNodeInfo.body.channelName);
            })
        }
    }
    async setBootstrapNode(remoteNodeId: NodeId, address: Address, webSocketAddress: Address | null, udpSocketAddress: Address | null) {
        const n = this.#remoteNodes.get(remoteNodeId)
        if (n) {
            if ((!n.isBootstrap()) || (!jsonObjectsMatch(n.bootstrapAddress(), address))) {
                this.#remoteNodes.delete(remoteNodeId);
            }
        }
        if (!this.#remoteNodes.has(remoteNodeId)) {
            const remoteNode = new RemoteNode(
                this.#node,
                remoteNodeId,
                {
                    isBootstrap: true,
                    bootstrapAddress: address,
                    bootstrapWebSocketAddress: webSocketAddress,
                    bootstrapUdpSocketAddress: udpSocketAddress
                }
            )
            this.#remoteNodes.set(remoteNodeId, remoteNode)
            this.#onBootstrapNodeAddedCallbacks.forEach(cb => {
                cb(remoteNode.remoteNodeId())
            })
        }
    }
    async getChannelInfo(channelName: ChannelName): Promise<ChannelInfo> {
        const nodes: ChannelNodeInfo[] = []
        this.#remoteNodes.forEach(n => {
            const cni = n.getChannelNodeInfo(channelName)
            if (cni !== null) {
                nodes.push(cni)
            }
        })
        if (this.#node.channelNames().includes(channelName)) {
            nodes.push(this.#node.getChannelNodeInfo(channelName))
        }
        return {
            nodes
        }
    }
    canSendRequestToNode(nodeId: NodeId, method: SendRequestMethod) {
        const remoteNode = this.#remoteNodes.get(nodeId)
        if (!remoteNode) {
            return false
        }
        return remoteNode.canSendRequest(method)
    }
    async sendRequestToNode(nodeId: NodeId, requestData: NodeToNodeRequestData, opts: {timeoutMsec: DurationMsec, method: SendRequestMethod}): Promise<NodeToNodeResponseData> {
        const remoteNode = this.#remoteNodes.get(nodeId)
        if (!remoteNode) {
            throw Error(`Cannot send request to node: node with ID ${nodeId} not found.`)
        }
        return await remoteNode.sendRequest(requestData, {timeoutMsec: opts.timeoutMsec, method: opts.method})
    }
    onNodeChannelAdded(callback: (remoteNodeId: NodeId, channelName: ChannelName) => void) {
        this.#onNodeChannelAddedCallbacks.push(callback)
    }
    onBootstrapNodeAdded(callback: (bootstrapNodeId: NodeId) => void) {
        this.#onBootstrapNodeAddedCallbacks.push(callback)
    }
    getRemoteNodesInChannel(channelName: ChannelName): RemoteNode[] {
        const ret: RemoteNode[] = []
        this.#remoteNodes.forEach((n, nodeId) => {
            if (n.getChannelNames().includes(channelName)) {
                ret.push(n)
            }
        });
        return ret
    }
    getBootstrapRemoteNodes(): RemoteNode[] {
        const ret: RemoteNode[] = []
        this.#remoteNodes.forEach((n, nodeId) => {
            if (n.isBootstrap() && (n.bootstrapAddress() !== null)) {
                ret.push(n)
            }
        })
        return ret
    }
    getAllRemoteNodes(): RemoteNode[] {
        const ret: RemoteNode[] = []
        this.#remoteNodes.forEach((n, nodeId) => {
            ret.push(n)
        })
        return ret
    }
    getRemoteNode(remoteNodeId: NodeId): RemoteNode | null {
        return this.#remoteNodes.get(remoteNodeId) || null
    }
    sendRequestToNodesInChannels(requestData: NodeToNodeRequestData, opts: {timeoutMsec: DurationMsec, channelNames: ChannelName[]}) {
        let finished = false;
        const _onResponseCallbacks: ((nodeId: NodeId, responseData: NodeToNodeResponseData) => void)[] = [];
        const _onErrorResponseCallbacks: ((nodeId: NodeId, reason: any) => void)[] = [];
        const _onFinishedCallbacks: (() => void)[] = [];
        const promises: (Promise<NodeToNodeResponseData>)[] = [];
        this.#remoteNodes.forEach(n => {
            const nodeChannelNames = n.getChannelNames();
            let okay = false;
            opts.channelNames.forEach(channelName => {
                if (nodeChannelNames.includes(channelName)) {
                    okay = true;
                }
            })
            if (okay) {
                const promise = this.sendRequestToNode(n.remoteNodeId(), requestData, {timeoutMsec: opts.timeoutMsec, method: 'default'});
                promise.then(responseData => {
                    if (finished) return;
                    _onResponseCallbacks.forEach(cb => {
                        cb(n.remoteNodeId(), responseData);
                    });
                })
                promise.catch((reason) => {
                    _onErrorResponseCallbacks.forEach(cb => {
                        cb(n.remoteNodeId(), reason);
                    });
                })
                promises.push(promise);
            }
        });
        const _finalize = () => {
            if (!finished) {
                finished = true;
                _onFinishedCallbacks.forEach(cb => {cb()});
            }
        }
        const _cancel = () => {
            // at some point in the future - cancel the pending requests
            _finalize()
        }
        const onResponse = (callback: (nodeId: NodeId, responseData: NodeToNodeResponseData) => void) => {
            _onResponseCallbacks.push(callback)
        }
        const onErrorResponse = (callback: (nodeId: NodeId, reason: any) => void) => {
            _onErrorResponseCallbacks.push(callback)
        }
        const onFinished = (callback: () => void) => {
            _onFinishedCallbacks.push(callback)
        }
        setTimeout(() => {
            _cancel();
        }, durationMsecToNumber(opts.timeoutMsec))
        // the .map is required so that we wait until all are settled
        Promise.all(promises.map(p => p.catch(e => e))).finally(() => {
            setTimeout(() => {
                _finalize()
            }, 0)
        })
        return {
            onResponse,
            onErrorResponse,
            onFinished,
            cancel: _cancel
        }
    }
}

// function cloneObject(obj) {
//     if (!obj) return obj;
//     return JSON.parse(JSON.stringify(obj));
// }

export default RemoteNodeManager;