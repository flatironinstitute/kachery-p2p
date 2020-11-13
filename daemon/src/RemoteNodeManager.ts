import { verifySignature } from './common/crypto_util';
import { Address, ChannelInfo, ChannelName, ChannelNodeInfo, durationGreaterThan, DurationMsec, durationMsecToNumber, elapsedSince, errorMessage, jsonObjectsMatch, NodeId, nodeIdToPublicKey, nowTimestamp, scaledDurationMsec, unscaledDurationMsec } from './interfaces/core';
import { AnnounceRequestData, AnnounceResponseData, NodeToNodeRequestData, NodeToNodeResponseData } from './interfaces/NodeToNodeRequest';
import KacheryP2PNode from './KacheryP2PNode';
import RemoteNode, { SendRequestMethod } from './RemoteNode';

class RemoteNodeManager {
    #node: KacheryP2PNode
    #remoteNodes = new Map<NodeId, RemoteNode>()
    #onNodeChannelAddedCallbacks: ((remoteNodeId: NodeId, channelName: ChannelName) => void)[] = []
    #onBootstrapNodeAddedCallbacks: ((bootstrapNodeId: NodeId) => void)[] = []
    #lastPrune = nowTimestamp()
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
                n.setLocalUdpAddressForRemoteNode(localUdpAddress)
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
            this.#remoteNodes.set(body.nodeId, new RemoteNode(this.#node, body.nodeId))
        }
        const n = this.#remoteNodes.get(body.nodeId)
        /* istanbul ignore next */
        if (!n) throw Error('Unexpected in setChannelNodeInfo')
        const newChannel = (!n.getChannelNames().includes(channelNodeInfo.body.channelName))
        n.setChannelNodeInfoIfMoreRecent(channelNodeInfo.body.channelName, channelNodeInfo)
        if (newChannel) {
            this.#onNodeChannelAddedCallbacks.forEach(cb => {
                cb(n.remoteNodeId(), channelNodeInfo.body.channelName)
            })
        }
    }
    async setBootstrapNode(remoteNodeId: NodeId, address: Address, webSocketAddress: Address | null, udpSocketAddress: Address | null, o: {isMessageProxy: boolean, isDataProxy: boolean}) {
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
                    isBootstrapMessageProxy: o.isMessageProxy,
                    isBootstrapDataProxy: o.isDataProxy,
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
    canSendRequestToNode(nodeId: NodeId, channelName: ChannelName, method: SendRequestMethod) {
        const remoteNode = this.#remoteNodes.get(nodeId)
        if (!remoteNode) {
            return false
        }
        return remoteNode.canSendRequest(method, channelName)
    }
    canReceiveMessagesFromNode(nodeId: NodeId): boolean {
        const n = this.getRemoteNode(nodeId)
        return n ? true : false
    }
    async sendRequestToNode(nodeId: NodeId, channelName: ChannelName, requestData: NodeToNodeRequestData, opts: {timeoutMsec: DurationMsec, method: SendRequestMethod}): Promise<NodeToNodeResponseData> {
        const remoteNode = this.#remoteNodes.get(nodeId)
        if (!remoteNode) {
            throw Error(`Cannot send request to node: node with ID ${nodeId} not found.`)
        }
        return await remoteNode.sendRequest(requestData, channelName, {timeoutMsec: opts.timeoutMsec, method: opts.method})
    }
    onNodeChannelAdded(callback: (remoteNodeId: NodeId, channelName: ChannelName) => void) {
        this.#onNodeChannelAddedCallbacks.push(callback)
    }
    onBootstrapNodeAdded(callback: (bootstrapNodeId: NodeId) => void) {
        this.#onBootstrapNodeAddedCallbacks.push(callback)
    }
    getRemoteNodesInChannel(channelName: ChannelName): RemoteNode[] {
        this._pruneRemoteNodes()
        const ret: RemoteNode[] = []
        this.#remoteNodes.forEach((n, nodeId) => {
            if (n.getChannelNames().includes(channelName)) {
                ret.push(n)
            }
        });
        return ret
    }
    getBootstrapRemoteNodes(): RemoteNode[] {
        this._pruneRemoteNodes()
        const ret: RemoteNode[] = []
        this.#remoteNodes.forEach((n, nodeId) => {
            if (n.isBootstrap() && (n.bootstrapAddress() !== null)) {
                ret.push(n)
            }
        })
        return ret
    }
    getAllRemoteNodes(): RemoteNode[] {
        this._pruneRemoteNodes()
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
        let finished = false
        let numComplete = 0
        let numTotal = 0
        const _onResponseCallbacks: ((nodeId: NodeId, channelName: ChannelName, responseData: NodeToNodeResponseData) => void)[] = [];
        const _onErrorResponseCallbacks: ((nodeId: NodeId, reason: any) => void)[] = [];
        const _onFinishedCallbacks: (() => void)[] = [];
        this.#remoteNodes.forEach(n => {
            const nodeChannelNames = n.getChannelNames()
            let okay = false
            let channelNameToUse: ChannelName | null = null
            opts.channelNames.forEach(channelName => {
                if (nodeChannelNames.includes(channelName)) {
                    channelNameToUse = channelName
                }
            })
            if ((channelNameToUse) && (this.canSendRequestToNode(n.remoteNodeId(), channelNameToUse, 'default'))) {
                numTotal ++
                ;(async () => {
                    let responseData: NodeToNodeResponseData
                    try {
                        responseData = await this.sendRequestToNode(n.remoteNodeId(), channelNameToUse, requestData, {timeoutMsec: opts.timeoutMsec, method: 'default'})
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
                        if (!channelNameToUse) throw Error('Unexpected channelNameToUse is null')
                        cb(n.remoteNodeId(), channelNameToUse, responseData)
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
        const onResponse = (callback: (nodeId: NodeId, channelName: ChannelName, responseData: NodeToNodeResponseData) => void) => {
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
        const elapsed = elapsedSince(this.#lastPrune)
        if (durationGreaterThan(unscaledDurationMsec(elapsed), scaledDurationMsec(30000))) {
            this.#lastPrune = nowTimestamp()
            const remoteNodeIds = this.#remoteNodes.keys()
            for (let nodeId of remoteNodeIds) {
                const rn = this.#remoteNodes.get(nodeId)
                if (!rn) throw Error('Unexpected in _pruneRemoteNodes')
                rn.pruneChannelNodeInfos()
                if (!rn.isBootstrap()) {
                    if (rn.getChannelNames().length === 0) {
                        this.#remoteNodes.delete(nodeId)
                    }
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