import { verifySignature } from './common/crypto_util';
import GarbageMap from './common/GarbageMap';
import { Address, ChannelConfigUrl, ChannelInfo, ChannelNodeInfo, DurationMsec, durationMsecToNumber, errorMessage, jsonObjectsMatch, NodeId, nodeIdToPublicKey, scaledDurationMsec } from './interfaces/core';
import { AnnounceRequestData, AnnounceResponseData, NodeToNodeRequestData, NodeToNodeResponseData } from './interfaces/NodeToNodeRequest';
import KacheryP2PNode from './KacheryP2PNode';
import RemoteNode, { channelNodeInfoIsExpired, SendRequestMethod } from './RemoteNode';

class RemoteNodeManager {
    #node: KacheryP2PNode
    #remoteNodes = new Map<NodeId, RemoteNode>()
    #onNodeChannelAddedCallbacks: ((remoteNodeId: NodeId, channelConfigUrl: ChannelConfigUrl) => void)[] = []
    #onBootstrapNodeAddedCallbacks: ((bootstrapNodeId: NodeId) => void)[] = []
    #recentWarnings = new GarbageMap<String, boolean>(scaledDurationMsec(1000 * 30))
    constructor(node: KacheryP2PNode) {
        this.#node = node;
    }
    async handleAnnounceRequest({fromNodeId, requestData, localUdpAddress}: {fromNodeId: NodeId, requestData: AnnounceRequestData, localUdpAddress: Address | null}): Promise<AnnounceResponseData> {
        // only handle this if we belong to this channel or we are a bootstrap node
        if (!this.#node.isBootstrapNode()) {
            if (!this.#node.hasJoinedChannel(requestData.channelNodeInfo.body.channelConfigUrl)) {
                return {
                    requestType: 'announce',
                    success: false,
                    errorMessage: errorMessage('Not a bootstrap and not a member of this channel.')
                };
            }
        }
        const { channelNodeInfo } = requestData;
        await this.setChannelNodeInfo(channelNodeInfo);
        if (localUdpAddress) {
            const n = this.#remoteNodes.get(channelNodeInfo.body.nodeId)
            if (n) {
                n.setLocalUdpAddressForRemoteNode(localUdpAddress)
            }
        }
        return {
            requestType: 'announce',
            success: true,
            errorMessage: null
        }
    }
    _printWarning(w: string) {
        if (this.#recentWarnings.has(w)) return
        this.#recentWarnings.set(w, true)
        console.warn(w)
    }
    async setChannelNodeInfo(channelNodeInfo: ChannelNodeInfo) {
        const { body, signature } = channelNodeInfo;
        if (channelNodeInfoIsExpired(channelNodeInfo)) return
        if (!verifySignature(body, signature, nodeIdToPublicKey(channelNodeInfo.body.nodeId))) {
            throw Error(`Invalid signature for channelNodeInfo: : ${body.nodeId} ${body.channelConfigUrl}`);
        }
        const localNodeChannelNodeInfo = await this.#node.getChannelNodeInfo(channelNodeInfo.body.channelConfigUrl)
        if (!localNodeChannelNodeInfo.body.isPublic) {
            if (!channelNodeInfo.body.isPublic) {
                if (!await this.#node.nodeIsAuthorizedForChannel(body.nodeId, body.channelConfigUrl)) {
                    this._printWarning(`Unauthorized node for channelNodeInfo: ${body.nodeId} ${body.channelConfigUrl}`)
                    return
                }
            }
        }
        if (body.nodeId === this.#node.nodeId()) {
            throw Error('Cannot set channel node info for self')
        }
        if (!this.#remoteNodes.has(body.nodeId)) {
            const remoteNodeOpts = {
                isBootstrap: false,
                isBootstrapMessageProxy: false,
                isBootstrapDataProxy: false,
                bootstrapAddress: null,
                bootstrapWebSocketAddress: null,
                bootstrapUdpSocketAddress: null
            }
            this.#remoteNodes.set(body.nodeId, new RemoteNode(this.#node, body.nodeId, remoteNodeOpts))
        }
        const n = this.#remoteNodes.get(body.nodeId)
        /* istanbul ignore next */
        if (!n) throw Error('Unexpected in setChannelNodeInfo')
        const newChannel = (!n.getJoinedChannelConfigUrls().includes(channelNodeInfo.body.channelConfigUrl))
        n.setChannelNodeInfoIfMoreRecent(channelNodeInfo.body.channelConfigUrl, channelNodeInfo)
        if (newChannel) {
            this.#onNodeChannelAddedCallbacks.forEach(cb => {
                cb(n.remoteNodeId(), channelNodeInfo.body.channelConfigUrl)
            })
        }
    }
    async setBootstrapNode(remoteNodeId: NodeId, address: Address, webSocketAddress: Address | null, udpSocketAddress: Address | null) {
        const n = this.#remoteNodes.get(remoteNodeId)
        if (n) {
            if ((!n.isBootstrap()) || (!jsonObjectsMatch(n.bootstrapAddress(), address))) {
                this.#remoteNodes.delete(remoteNodeId)
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
    async getChannelInfo(channelConfigUrl: ChannelConfigUrl): Promise<ChannelInfo> {
        const nodes: ChannelNodeInfo[] = []
        this.#remoteNodes.forEach(n => {
            const cni = n.getChannelNodeInfo(channelConfigUrl)
            if (cni !== null) {
                nodes.push(cni)
            }
        })
        if (this.#node.hasJoinedChannel(channelConfigUrl)) {
            nodes.push(await this.#node.getChannelNodeInfo(channelConfigUrl))
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
    canReceiveMessagesFromNode(nodeId: NodeId): boolean {
        const n = this.getRemoteNode(nodeId)
        return n ? true : false
    }
    async sendRequestToNode(nodeId: NodeId, requestData: NodeToNodeRequestData, opts: {timeoutMsec: DurationMsec, method: SendRequestMethod}): Promise<NodeToNodeResponseData> {
        const remoteNode = this.#remoteNodes.get(nodeId)
        if (!remoteNode) {
            throw Error(`Cannot send request to node: node with ID ${nodeId} not found.`)
        }
        return await remoteNode.sendRequest(requestData, {timeoutMsec: opts.timeoutMsec, method: opts.method})
    }
    onNodeChannelAdded(callback: (remoteNodeId: NodeId, channelConfigUrl: ChannelConfigUrl) => void) {
        this.#onNodeChannelAddedCallbacks.push(callback)
    }
    onBootstrapNodeAdded(callback: (bootstrapNodeId: NodeId) => void) {
        this.#onBootstrapNodeAddedCallbacks.push(callback)
    }
    getRemoteNodesInChannel(channelConfigUrl: ChannelConfigUrl, args: {includeOffline: boolean}): RemoteNode[] {
        this._pruneRemoteNodes()
        const ret: RemoteNode[] = []
        this.#remoteNodes.forEach((n, nodeId) => {
            if ((args.includeOffline) || (n.isOnline())) {
                if (n.getJoinedChannelConfigUrls().includes(channelConfigUrl)) {
                    ret.push(n)
                }
            }
        });
        return ret
    }
    getBootstrapRemoteNodes(args: {includeOffline: boolean}): RemoteNode[] {
        this._pruneRemoteNodes()
        const ret: RemoteNode[] = []
        this.#remoteNodes.forEach((n, nodeId) => {
            if (n.isBootstrap() && (n.bootstrapAddress() !== null)) {
                if ((args.includeOffline) || (n.isOnline())) {
                    ret.push(n)
                }
            }
        })
        return ret
    }
    getAllRemoteNodes(args: {includeOffline: boolean}): RemoteNode[] {
        this._pruneRemoteNodes()
        const ret: RemoteNode[] = []
        this.#remoteNodes.forEach((n, nodeId) => {
            if ((args.includeOffline) || (n.isOnline())) {
                ret.push(n)
            }
        })
        return ret
    }
    getRemoteNode(remoteNodeId: NodeId): RemoteNode | null {
        return this.#remoteNodes.get(remoteNodeId) || null
    }
    sendRequestToAllNodes(requestData: NodeToNodeRequestData, opts: {timeoutMsec: DurationMsec}) {
        let finished = false
        let numComplete = 0
        let numTotal = 0
        const _onResponseCallbacks: ((nodeId: NodeId, responseData: NodeToNodeResponseData) => void)[] = [];
        const _onErrorResponseCallbacks: ((nodeId: NodeId, reason: any) => void)[] = [];
        const _onFinishedCallbacks: (() => void)[] = [];
        this.#remoteNodes.forEach(n => {
            if (this.canSendRequestToNode(n.remoteNodeId(), 'default')) {
                numTotal ++
                ;(async () => {
                    let responseData: NodeToNodeResponseData
                    try {
                        responseData = await this.sendRequestToNode(n.remoteNodeId(), requestData, {timeoutMsec: opts.timeoutMsec, method: 'default'})
                    }
                    catch(err) {
                        _onErrorResponseCallbacks.forEach(cb => {
                            cb(n.remoteNodeId(), err)
                        });
                        numComplete ++
                        _checkComplete()
                        return
                    }
                    if (finished) return;
                    _onResponseCallbacks.forEach(cb => {
                        cb(n.remoteNodeId(), responseData)
                    });
                    numComplete ++
                    _checkComplete()
                })()
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
        const onErrorResponse = (callback: (nodeId: NodeId, error: Error) => void) => {
            _onErrorResponseCallbacks.push(callback)
        }
        const onFinished = (callback: () => void) => {
            _onFinishedCallbacks.push(callback)
        }
        setTimeout(() => {
            _cancel();
        }, durationMsecToNumber(opts.timeoutMsec))

        const _checkComplete = () => {
            if (numComplete === numTotal) {
                setTimeout(() => {
                    _finalize()
                }, 0)
            }
        }
        return {
            onResponse,
            onErrorResponse,
            onFinished,
            cancel: _cancel
        }
    }
    remoteNodeIsOnline(nodeId: NodeId) {
        const rn = this.#remoteNodes.get(nodeId)
        return (rn && rn.isOnline())
    }
    _pruneRemoteNodes() {
        const remoteNodeIds = this.#remoteNodes.keys()
        for (let nodeId of remoteNodeIds) {
            const rn = this.#remoteNodes.get(nodeId)
            if (!rn) throw Error('Unexpected in _pruneRemoteNodes')
            rn.pruneChannelNodeInfos()
            if (!rn.isBootstrap()) {
                if (rn.getJoinedChannelConfigUrls().length === 0) {
                    this.#remoteNodes.delete(nodeId)
                }
            }
        }
    }
}

// function cloneObject(obj) {
//     if (!obj) return obj;
//     return JSON.parse(JSON.stringify(obj));
// }

export default RemoteNodeManager;