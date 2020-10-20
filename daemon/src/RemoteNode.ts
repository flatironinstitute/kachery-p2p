import { getSignature, verifySignature } from "./common/crypto_util";
import DataStreamy from "./common/DataStreamy";
import { Address, ByteCount, ChannelName, ChannelNodeInfo, createRequestId, DurationMsec, NodeId, nodeIdToPublicKey, nowTimestamp, urlPath } from "./interfaces/core";
import { isNodeToNodeResponse, NodeToNodeRequest, NodeToNodeRequestData, NodeToNodeResponse, NodeToNodeResponseData, StreamId } from "./interfaces/NodeToNodeRequest";
import KacheryP2PNode from "./KacheryP2PNode";
import { protocolVersion } from "./protocolVersion";

export type SendRequestMethod = 'default' | 'http' | 'udp'

class RemoteNode {
    #node: KacheryP2PNode
    #remoteNodeId: NodeId
    #channelNodeInfoByChannel = new Map<ChannelName, ChannelNodeInfo>()
    #isBootstrap: boolean
    #bootstrapAddress: Address | null
    #bootstrapWebSocketAddress: Address | null
    #bootstrapUdpSocketAddress: Address | null
    #fileSizesByFileKey: ByteCount | null
    #localUdpAddress: Address | null = null
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
        return ret
    }
    getChannelNodeInfo(channelName: ChannelName): ChannelNodeInfo | null {
        return this.#channelNodeInfoByChannel.get(channelName) || null
    }
    getRemoteNodeWebSocketAddress(): Address | null {
        const ret = this.bootstrapWebSocketAddress()
        if (ret) return ret
        this.#channelNodeInfoByChannel.forEach((cni, channelName) => {
            if (cni.body.webSocketAddress) {
                return cni.body.webSocketAddress
            }
        })
        return null
    }
    setLocalUdpAddress(address: Address | null) {
        this.#localUdpAddress = address
    }
    getLocalUdpAddress() {
        return this.#localUdpAddress
    }
    _formRequestFromRequestData(requestData: NodeToNodeRequestData): NodeToNodeRequest {
        const requestId = createRequestId()
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
        let address: Address | null = null
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
    _determineDefaultSendRequestMethod(): SendRequestMethod | null {
        if (this._getRemoteNodeHttpAddress()) {
            return 'http'
        }
        else if ((this.#node.publicUdpSocketServer()) && ((this.#bootstrapUdpSocketAddress) || (this.getLocalUdpAddress()))) {
            return 'udp'
        }
        else {
            return null
        }
    }
    _determineDefaultDownloadFileDataMethod(): SendRequestMethod | null {
        if (this._getRemoteNodeHttpAddress()) {
            return 'http'
        }
        else if ((this.#node.publicUdpSocketServer()) && ((this.#bootstrapUdpSocketAddress) || (this.getLocalUdpAddress()))) {
            return 'udp'
        }
        else {
            return null
        }
    }
    canSendRequest(method: SendRequestMethod): boolean {
        if (method === 'default') {
            const m = this._determineDefaultSendRequestMethod()
            if (!m) return false
            method = m
        }
        if (method === 'http') {
            const address = this._getRemoteNodeHttpAddress();
            if (!address) {
                return false
            }
            return true
        }
        else if (method === 'udp') {
            const udpS = this.#node.publicUdpSocketServer()
            const udpA = this.#localUdpAddress || this.#bootstrapUdpSocketAddress
            if (!udpS) {
                return false
            }
            if (!udpA) {
                return false
            }
            return true
        }
        else {
            return false
        }
    }
    async downloadFileData(streamId: StreamId, opts: {method: SendRequestMethod}): Promise<DataStreamy> {
        let method: SendRequestMethod | null = opts.method
        if (method === 'default') {
            method = this._determineDefaultDownloadFileDataMethod()
            if (!method) {
                throw Error('No method available to download stream')
            }
        }
        if (method === 'http') {
            const address = this._getRemoteNodeHttpAddress();
            if (!address) {
                throw Error('Unable to download file data... no http address found.')
            }
            return await this.#node.httpGetDownload(address, urlPath(`/download/${this.remoteNodeId()}/${streamId}`))
        }
        else if (method === 'udp') {
            throw Error('not yet implemented')
        }
        else {
            throw Error ('Unexpected')
        }
    }
    async sendRequest(requestData: NodeToNodeRequestData, opts: {timeoutMsec: DurationMsec, method: SendRequestMethod }): Promise<NodeToNodeResponseData> {
        const request = this._formRequestFromRequestData(requestData);
        const requestId = request.body.requestId;

        let method: SendRequestMethod | null = opts.method
        if (method === 'default') {
            method = this._determineDefaultSendRequestMethod()
            if (!method) {
                throw Error('No method available to send message')
            }
        }

        let response: NodeToNodeResponse
        if (method === 'http') {
            const address = this._getRemoteNodeHttpAddress();
            if (!address) {
                throw Error('Unable to send request... no http address found.')
            }
            const R = await this.#node.httpPostJson(address, urlPath('/NodeToNodeRequest'), request, {timeoutMsec: opts.timeoutMsec});
            if (!isNodeToNodeResponse(R)) {
                // ban the node?
                throw Error('Invalid response from node.');
            }
            response = R
        }
        else if (method === 'udp') {
            const udpS = this.#node.publicUdpSocketServer()
            const udpA = this.#localUdpAddress || this.#bootstrapUdpSocketAddress
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
            // ban the node?
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