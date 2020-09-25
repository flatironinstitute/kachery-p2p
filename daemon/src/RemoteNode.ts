import { getSignature, verifySignature } from "./common/crypto_util";
import { sleepMsec } from "./common/util";
import { httpPostJson } from "./httpPostJson";
import { Address, ChannelName, ChannelNodeInfo, createRequestId, NodeId, nodeIdToPublicKey, nowTimestamp } from "./interfaces/core";
import { isNodeToNodeResponse, NodeToNodeRequest, NodeToNodeRequestData, NodeToNodeResponseData } from "./interfaces/NodeToNodeRequest";
import KacheryP2PNode from "./KacheryP2PNode";

class RemoteNode {
    #node: KacheryP2PNode
    #remoteNodeId: NodeId
    #channelNodeInfoByChannel: Map<ChannelName, ChannelNodeInfo> = new Map<ChannelName, ChannelNodeInfo>()
    #isBootstrap: boolean
    #bootstrapAddress: Address | null
    #bootstrapWebSocketAddress: Address | null
    constructor(node: KacheryP2PNode, remoteNodeId: NodeId, opts: {isBootstrap: boolean, bootstrapAddress: Address | null, bootstrapWebSocketAddress: Address | null} = {isBootstrap: false, bootstrapAddress: null, bootstrapWebSocketAddress: null}) {
        this.#node = node
        this.#remoteNodeId = remoteNodeId;
        this.#isBootstrap = opts.isBootstrap
        this.#bootstrapAddress = opts.bootstrapAddress
        this.#bootstrapWebSocketAddress = opts.bootstrapWebSocketAddress
    }
    remoteNodeId() {
        return this.#remoteNodeId;
    }
    isBootstrap() {
        return this.#isBootstrap
    }
    bootstrapAddress() {
        return this.#bootstrapAddress
    }
    bootstrapWebSocketAddress() {
        return this.#bootstrapWebSocketAddress
    }
    setChannelNodeInfoIfMoreRecent(channelName: ChannelName, channelNodeInfo: ChannelNodeInfo) {
        if (this.#channelNodeInfoByChannel.has(channelName)) {
            const x = this.#channelNodeInfoByChannel.get(channelName);
            if (!x) throw Error('Unexpected.');
            if (x.body.timestamp > channelNodeInfo.body.timestamp) {
                // already have more recent
                return;
            }
        }
        this.#channelNodeInfoByChannel.set(channelName, channelNodeInfo);
    }
    getChannelNames() {
        let ret: ChannelName[] = [];
        this.#channelNodeInfoByChannel.forEach((channelNodeInfo, channelName) => {
            ret.push(channelName);
        });
        return ret;
    }
    getChannelNodeInfo(channelName: ChannelName): ChannelNodeInfo | null {
        return this.#channelNodeInfoByChannel.get(channelName) || null;
    }
    _formRequestFromRequestData(requestData: NodeToNodeRequestData): NodeToNodeRequest {
        const requestId = createRequestId();
        const requestBody = {
            requestId,
            fromNodeId: this.#node.nodeId(),
            toNodeId: this.#remoteNodeId,
            timestamp: nowTimestamp(),
            requestData
        }
        const request: NodeToNodeRequest = {
            body: requestBody,
            signature: getSignature(requestBody, this.#node.keyPair())
        }
        return request
    }
    _getRemoteNodeHttpAddress(): Address | null {
        let address: Address | null = null;
        if (this.#isBootstrap && this.#bootstrapAddress) {
            return this.#bootstrapAddress
        }
        else {
            const channelNodeData = this._getMostRecentChannelNodeInfo();
            if (channelNodeData === null) {
                return null;
            }
            const remoteInfo = channelNodeData.body;
            if (remoteInfo.httpAddress) {
                return remoteInfo.httpAddress;
            }
            else {
                if (remoteInfo.proxyHttpAddresses.length > 0) {
                    return remoteInfo.proxyHttpAddresses[0];
                }
                else {
                    return null;
                }
            }
        }
    }
    async sendRequest(requestData: NodeToNodeRequestData, opts: {timeoutMsec: number}): Promise<NodeToNodeResponseData> {
        const address = this._getRemoteNodeHttpAddress();
        if (!address) {
            throw Error('Unable to send request... no http address found.')
        }
        const request = this._formRequestFromRequestData(requestData);
        const requestId = request.body.requestId;
        const response = await httpPostJson(address, '/NodeToNodeRequest', request, {timeoutMsec: opts.timeoutMsec});
        if (!isNodeToNodeResponse(response)) {
            // todo: in this situation, do we ban the node?
            throw Error('Invalid response from node.');
        }
        if (response.body.responseData.requestType !== request.body.requestData.requestType) {
            throw Error('Unexpected requestType in response.')
        }
        if (response.body.fromNodeId !== this.#remoteNodeId) {
            throw Error('Unexpected fromNodeId in response.')
        }
        if (response.body.toNodeId !== this.#node.nodeId()) {
            throw Error('Unexpected toNodeId in response.')
        }
        if (response.body.requestId !== requestId) {
            throw Error('Unexpected requestId in response.')
        }
        if (Number(response.body.timestamp) < Number(request.body.timestamp) - 1000) {
            throw Error('Unexpected early timestamp in response.')
        }
        if (!verifySignature(response.body, response.signature, nodeIdToPublicKey(this.#remoteNodeId))) {
            // todo: in this situation, do we ban the node?
            throw Error('Invalid signature in response.');
        }
        return response.body.responseData;
    }
    sendDownloadRequest(requestData: NodeToNodeRequestData) {
        const address = this._getRemoteNodeHttpAddress();
        if (!address) {
            throw Error('Unable to send request... no http address found.')
        }
        const request = this._formRequestFromRequestData(requestData);
        const requestId = request.body.requestId;

        // todo: post the request and stream the response

        const _onDataCallbacks: ((data: Buffer) => void)[] = [];
        const _onFinishedCallbacks: (() => void)[] = [];
        const _onErrorCallbacks: ((err: Error) => void)[] = [];
        const _cancel = () => {
            // todo
        }
        return {
            onData: (callback: (data: Buffer) => void) => {_onDataCallbacks.push(callback)},
            onFinished: (callback: () => void) => {_onFinishedCallbacks.push(callback)},
            onError: (callback: (err: Error) => void) => {_onErrorCallbacks.push(callback)},
            cancel: _cancel
        }
    }
    _getMostRecentChannelNodeInfo(): ChannelNodeInfo | null {
        let result: ChannelNodeInfo | null = null;
        this.#channelNodeInfoByChannel.forEach((channelNodeInfo, channelName) => {
            if ((result === null) || (channelNodeInfo.body.timestamp > result.body.timestamp)) {
                result = channelNodeInfo;
            }
        })
        return result;
    }
}

export default RemoteNode;