import { getSignature, verifySignature } from "./common/crypto_util";
import DataStreamy from "./common/DataStreamy";
import { addByteCount, Address, byteCount, ByteCount, ChannelName, ChannelNodeInfo, createRequestId, DurationMsec, NodeId, nodeIdToPublicKey, nowTimestamp, scaledDurationMsec, urlPath } from "./interfaces/core";
import { DownloadFileDataRequestData, isNodeToNodeResponse, isStartStreamViaUdpResponseData, NodeToNodeRequest, NodeToNodeRequestData, NodeToNodeResponse, NodeToNodeResponseData, StartStreamViaUdpRequestData, StreamId } from "./interfaces/NodeToNodeRequest";
import KacheryP2PNode from "./KacheryP2PNode";
import { protocolVersion } from "./protocolVersion";
import { nodeIdFallbackAddress } from './services/PublicUdpSocketServer';

export type SendRequestMethod = 'default' | 'http' | 'http-proxy' | 'udp' | 'prefer-udp' | 'prefer-http' | 'udp-fallback'

export interface RemoteNodeStats {
    remoteNodeId: NodeId
    channelNodeInfos: ChannelNodeInfo[]
    isBootstrap: boolean
    bootstrapAddress: Address | null
    bootstrapWebSocketAddress: Address | null
    bootstrapUdpSocketAddress: Address | null
    localUdpAddressForRemoteNode: Address | null
    numUdpBytesSent: ByteCount
    numUdpBytesLost: ByteCount
    numHttpBytesSent: ByteCount
    numRequestsSent: number
    numResponsesReceived: number
}


class RemoteNode {
    #node: KacheryP2PNode
    #remoteNodeId: NodeId
    #channelNodeInfoByChannel = new Map<ChannelName, ChannelNodeInfo>()
    #isBootstrap: boolean
    #bootstrapAddress: Address | null
    #bootstrapWebSocketAddress: Address | null
    #bootstrapUdpSocketAddress: Address | null
    #localUdpAddressForRemoteNode: Address | null = null
    #numUdpBytesSent: ByteCount = byteCount(0)
    #numUdpBytesLost: ByteCount = byteCount(0)
    #numHttpBytesSent: ByteCount = byteCount(0)
    #numRequestsSent: number = 0
    #numResponsesReceived: number = 0
    #isOnline: boolean = false
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
    remoteNodeLabel() {
        const cni = this._getMostRecentChannelNodeInfo()
        return cni ? cni.body.nodeLabel : null
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
        this.#channelNodeInfoByChannel.set(channelName, channelNodeInfo)
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
    setLocalUdpAddressForRemoteNode(address: Address | null) {
        this.#localUdpAddressForRemoteNode = address
    }
    getLocalUdpAddressForRemoteNode(): Address | null {
        return this.#localUdpAddressForRemoteNode
    }
    getPublicUdpAddressForRemoteNode(): Address | null {
        let ret: Address | null = null
        this.#channelNodeInfoByChannel.forEach((channelNodeInfo, channelName) => {
            if (ret === null) {
                if (channelNodeInfo.body.publicUdpSocketAddress) {
                    ret = channelNodeInfo.body.publicUdpSocketAddress
                }
            }
        })
        return ret
    }
    getUdpAddressForRemoteNode(): Address | null {
        return (this.#bootstrapUdpSocketAddress) || (this.getLocalUdpAddressForRemoteNode()) || (this.getPublicUdpAddressForRemoteNode())
    }
    getStats() {
        const channelNodeInfos: ChannelNodeInfo[] = []
        this.#channelNodeInfoByChannel.forEach((cni) => {
            channelNodeInfos.push(cni)
        })
        const s: RemoteNodeStats = {
            remoteNodeId: this.#remoteNodeId,
            channelNodeInfos,
            isBootstrap: this.#isBootstrap,
            bootstrapAddress: this.#bootstrapAddress,
            bootstrapWebSocketAddress: this.#bootstrapWebSocketAddress,
            bootstrapUdpSocketAddress: this.#bootstrapUdpSocketAddress,
            localUdpAddressForRemoteNode: this.#localUdpAddressForRemoteNode,
            numUdpBytesSent: this.#numUdpBytesSent,
            numUdpBytesLost: this.#numUdpBytesLost,
            numHttpBytesSent: this.#numHttpBytesSent,
            numRequestsSent: this.#numRequestsSent,
            numResponsesReceived: this.#numResponsesReceived
        }
        return s
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
        if (this.#isBootstrap && this.#bootstrapAddress) {
            return this.#bootstrapAddress
        }
        else {
            const channelNodeData = this._getMostRecentChannelNodeInfo();
            if (channelNodeData === null) {
                return null;
            }
            const remoteInfo = channelNodeData.body
            if (remoteInfo.httpAddress) {
                return remoteInfo.httpAddress
            }
            else {
                return null
            }
        }
    }
    _getRemoteNodeHttpProxyAddress(): Address | null {
        const channelNodeData = this._getMostRecentChannelNodeInfo();
        if (channelNodeData === null) {
            return null;
        }
        const remoteInfo = channelNodeData.body
        if (remoteInfo.proxyHttpAddresses.length > 0) {
            return remoteInfo.proxyHttpAddresses[0]
        }
        else {
            return null;
        }
    }
    _determineSendRequestMethod(method: SendRequestMethod): SendRequestMethod | null {
        if (method === 'udp-fallback') {
            if (this._getRemoteNodeHttpAddress()) {
                return 'http'
            }
            else if (this._getRemoteNodeHttpProxyAddress()) {
                return 'http-proxy'
            }
            else {
                return null
            }
        }
        else if ((method === 'default') || (method === 'prefer-http')) {
            if (this._getRemoteNodeHttpAddress()) {
                return 'http'
            }
            else if (this._getRemoteNodeHttpProxyAddress()) {
                return 'http-proxy'
            }
            else if ((this.#node.publicUdpSocketServer()) && (this.getUdpAddressForRemoteNode())) {
                return 'udp'
            }
            else {
                return null
            }
        }
        else if (method === 'prefer-udp') {
            if ((this.#node.publicUdpSocketServer()) && (this.getUdpAddressForRemoteNode())) {
                return 'udp'
            }
            else if (this._getRemoteNodeHttpAddress()) {
                return 'http'
            }
            else if (this._getRemoteNodeHttpProxyAddress()) {
                return 'http-proxy'
            }
            else {
                return null
            }
        }
        else if ((method === 'http') || (method === 'udp') || (method === 'http-proxy')) {
            return method
        }
        else {
            return null
        }
    }
    _determineDefaultDownloadFileDataMethod(): SendRequestMethod | null {
        if (this._getRemoteNodeHttpAddress()) {
            return 'http'
        }
        else if (this._getRemoteNodeHttpProxyAddress()) {
            return 'http-proxy'
        }
        else if ((this.#node.publicUdpSocketServer()) && (this.getUdpAddressForRemoteNode())) {
            return 'udp'
        }
        else {
            return null
        }
    }
    canSendRequest(method: SendRequestMethod): boolean {
        let method2 = this._determineSendRequestMethod(method)
        if (method2 === null) return false
        if (method2 === 'http') {
            const address = this._getRemoteNodeHttpAddress()
            if (!address) {
                return false
            }
            return true
        }
        else if (method2 === 'http-proxy') {
            const address = this._getRemoteNodeHttpProxyAddress()
            if (!address) {
                return false
            }
            return true
        }
        else if (method2 === 'udp') {
            const udpS = this.#node.publicUdpSocketServer()
            const udpA = this.getUdpAddressForRemoteNode()
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
            return await this.#node.externalInterface().httpGetDownload(address, urlPath(`/download/${this.remoteNodeId()}/${streamId}`))
        }
        else if (method === 'http-proxy') {
            const address = this._getRemoteNodeHttpProxyAddress();
            if (!address) {
                throw Error('Unable to download file data... no http-proxy address found.')
            }
            return await this.#node.externalInterface().httpGetDownload(address, urlPath(`/download/${this.remoteNodeId()}/${streamId}`))
        }
        else if (method === 'udp') {
            return await this._streamDataViaUdpFromRemoteNode(streamId)
        }
        else {
            /* istanbul ignore next */
            throw Error ('Unexpected')
        }
    }
    async _streamDataViaUdpFromRemoteNode(streamId: StreamId): Promise<DataStreamy> {
        const udpS = this.#node.publicUdpSocketServer()
        if (!udpS) {
            /* istanbul ignore next */
            throw Error('Cannot stream from remote node without udp socket server')
        }
        const requestData: StartStreamViaUdpRequestData = {
            requestType: 'startStreamViaUdp',
            streamId
        }
        const incomingDataStream = udpS.getIncomingDataStream(streamId)
        try {
            const responseData = await this.sendRequest(requestData, {timeoutMsec: scaledDurationMsec(5000), method: 'default'})
            if (!isStartStreamViaUdpResponseData(responseData)) {
                /* istanbul ignore next */
                console.warn(responseData)
                /* istanbul ignore next */
                throw Error('unexpected')
            }
            if (!responseData.success) {
                throw Error(`Error starting stream via udp: ${responseData.errorMessage}`)
            }
        }
        catch(err) {
            incomingDataStream.producer().error(err)
        }
        return incomingDataStream
    }
    async startStreamViaUdpToRemoteNode(streamId: StreamId): Promise<void> {
        const r: DownloadFileDataRequestData | null = this.#node.downloadStreamManager().get(streamId)
        if (r === null) {
            /* istanbul ignore next */
            throw Error('Stream not found')
        }

        const udpS = this.#node.publicUdpSocketServer()
        const udpA = this.getUdpAddressForRemoteNode()
        if (!udpS) {
            /* istanbul ignore next */
            throw Error('Cannot use stream via udp when there is no udp socket server')
        }
        if (!udpA) {
            /* istanbul ignore next */
            throw Error('Cannot stream via udp when there is no udp address')
        }

        const ds = await this.#node.kacheryStorageManager().getFileReadStream(r.fileKey)
        const fallbackAddress = nodeIdFallbackAddress(this.#remoteNodeId)
        udpS.setOutgoingDataStream(udpA, fallbackAddress, streamId, ds)
    }
    async sendRequest(requestData: NodeToNodeRequestData, opts: {timeoutMsec: DurationMsec, method: SendRequestMethod }): Promise<NodeToNodeResponseData> {
        try {
            const ret = await this._trySendRequest(requestData, opts)
            this._setOnline(true)
            return ret
        }
        catch(err) {
            this._setOnline(false)
            throw err
        }
    }
    _setOnline(val: boolean) {
        if (val === this.#isOnline) return
        this.#isOnline = val
    }
    isOnline() {
        return this.#isOnline
    }
    async _trySendRequest(requestData: NodeToNodeRequestData, opts: {timeoutMsec: DurationMsec, method: SendRequestMethod }): Promise<NodeToNodeResponseData> {
        const request = this._formRequestFromRequestData(requestData);
        const requestId = request.body.requestId;

        let method2 = this._determineSendRequestMethod(opts.method)
        if (method2 === null) {
            throw Error(`Method not available for sending request ${requestData.requestType}: ${opts.method} (from ${this.#node.nodeId().slice(0, 6)} to ${this.#remoteNodeId.slice(0, 6)})`)
        }

        const requestSize = byteCount(JSON.stringify(request).length)

        let response: NodeToNodeResponse
        if ((method2 === 'http') || (method2 === 'http-proxy')) {
            let address: Address | null
            if (method2 === 'http') {
                address = this._getRemoteNodeHttpAddress()
                if (!address) {
                    throw Error('Unable to send request... no http address found.')
                }
            }
            else if (method2 === 'http-proxy') {
                address = this._getRemoteNodeHttpProxyAddress()
                if (!address) {
                    throw Error('Unable to send request... no http-proxy address found.')
                }
            }
            else {
                throw Error('Unexpected')
            }
            this.#numHttpBytesSent = addByteCount(this.#numHttpBytesSent, requestSize)
            this.#numRequestsSent ++
            const R = await this.#node.externalInterface().httpPostJson(address, urlPath('/NodeToNodeRequest'), request, {timeoutMsec: opts.timeoutMsec});
            if (!isNodeToNodeResponse(R)) {
                // ban the node?
                throw Error('Invalid response from node.');
            }
            this.#numResponsesReceived ++
            response = R
        }
        else if (method2 === 'udp') {
            const udpS = this.#node.publicUdpSocketServer()
            const udpA = this.getUdpAddressForRemoteNode()
            if (!udpS) {
                /* istanbul ignore next */
                throw Error('Cannot use udp method when there is no udp socket server')
            }
            if (!udpA) {
                /* istanbul ignore next */
                throw Error('Cannot use udp method when there is no udp address')
            }
            this.#numUdpBytesSent = addByteCount(this.#numUdpBytesSent, requestSize)
            this.#numRequestsSent ++
            const R = await udpS.sendRequest(udpA, request, {timeoutMsec: opts.timeoutMsec})
            this.#numResponsesReceived ++
            response = R.response
            const udpHeader = R.header
            if (this.#isBootstrap) {
                // only trust the reported public udp address if it is a bootstrap node
                const publicUdpAddress = udpHeader.body.toAddress
                if (publicUdpAddress) {
                    this.#node.setPublicUdpSocketAddress(publicUdpAddress)
                }
            }
        }
        else {
            /* istanbul ignore next */
            throw Error ('Unexpected')
        }
        if (response.body.responseData.requestType !== request.body.requestData.requestType) {
            /* istanbul ignore next */
            throw Error('Unexpected requestType in response.')
        }
        if (response.body.fromNodeId !== this.#remoteNodeId) {
            /* istanbul ignore next */
            throw Error('Unexpected fromNodeId in response.')
        }
        if (response.body.toNodeId !== this.#node.nodeId()) {
            /* istanbul ignore next */
            throw Error('Unexpected toNodeId in response.')
        }
        if (response.body.requestId !== requestId) {
            /* istanbul ignore next */
            throw Error('Unexpected requestId in response.')
        }
        if (Number(response.body.timestamp) < Number(request.body.timestamp) - 1000) {
            /* istanbul ignore next */
            throw Error('Unexpected early timestamp in response.')
        }
        if (!verifySignature(response.body, response.signature, nodeIdToPublicKey(this.#remoteNodeId))) {
            // ban the node?
            throw Error('Invalid signature in response.');
        }
        this._setOnline(true)
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