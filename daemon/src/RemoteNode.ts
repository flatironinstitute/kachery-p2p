import { getSignature, verifySignature } from "./common/crypto_util";
import { httpPostJson, urlPath } from "./common/httpPostJson";
import { Address, ChannelName, ChannelNodeInfo, createRequestId, NodeId, nodeIdToPublicKey, nowTimestamp } from "./interfaces/core";
import { isNodeToNodeResponse, NodeToNodeRequest, NodeToNodeRequestData, NodeToNodeResponse, NodeToNodeResponseData } from "./interfaces/NodeToNodeRequest";
import KacheryP2PNode from "./KacheryP2PNode";
import { protocolVersion } from "./protocolVersion";

export type SendRequestMethod = 'default' | 'udp'

class RemoteNode {
    #node: KacheryP2PNode
    #remoteNodeId: NodeId
    #channelNodeInfoByChannel: Map<ChannelName, ChannelNodeInfo> = new Map<ChannelName, ChannelNodeInfo>()
    #isBootstrap: boolean
    #bootstrapAddress: Address | null
    #bootstrapWebSocketAddress: Address | null
    #bootstrapUdpSocketAddress: Address | null
    constructor(node: KacheryP2PNode, remoteNodeId: NodeId, opts: {
        isBootstrap: boolean,
        bootstrapAddress: Address | null,
        bootstrapWebSocketAddress: Address | null,
        bootstrapUdpSocketAddress: Address | null,
    } = {isBootstrap: false, bootstrapAddress: null, bootstrapWebSocketAddress: null, bootstrapUdpSocketAddress: null}) {
        this.#node = node
        this.#remoteNodeId = remoteNodeId;
        this.#isBootstrap = opts.isBootstrap
        this.#bootstrapAddress = opts.bootstrapAddress
        this.#bootstrapWebSocketAddress = opts.bootstrapWebSocketAddress
        this.#bootstrapUdpSocketAddress = opts.bootstrapUdpSocketAddress
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
    bootstrapUdpSocketAddress() {
        return this.#bootstrapUdpSocketAddress
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
            protocolVersion: protocolVersion(),
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
    async sendRequest(requestData: NodeToNodeRequestData, opts: {timeoutMsec: number, method: SendRequestMethod }): Promise<NodeToNodeResponseData> {
        const address = this._getRemoteNodeHttpAddress();
        if (!address) {
            throw Error('Unable to send request... no http address found.')
        }
        const request = this._formRequestFromRequestData(requestData);
        const requestId = request.body.requestId;
        // todo: use udp when appropriate
        let response: NodeToNodeResponse
        if (opts.method === 'default') {
            const R = await httpPostJson(address, urlPath('/NodeToNodeRequest'), request, {timeoutMsec: opts.timeoutMsec});
            if (!isNodeToNodeResponse(R)) {
                // todo: in this situation, do we ban the node?
                throw Error('Invalid response from node.');
            }
            response = R
        }
        else if (opts.method === 'udp') {
            const udpS = this.#node.publicUdpSocketServer()
            const udpA = this.#bootstrapUdpSocketAddress
            if (!udpS) {
                throw Error('Cannot use udp method when there is no udp socket server')
            }
            if (!udpA) {
                throw Error('Cannot use udp method when there is no udp address')
            }
            const R = await udpS.sendRequest(udpA, request, {timeoutMsec: opts.timeoutMsec})
            response = R.response
            const udpHeader = R.header
            if (this.#isBootstrap) {
                const publicUdpAddress = udpHeader.body.toAddress
                this.#node.setPublicUdpSocketAddress(publicUdpAddress)
            }
        }
        else {
            throw Error ('Unexpected')
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