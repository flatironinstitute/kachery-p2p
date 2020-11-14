import { TIMEOUTS } from "./common/constants";
import { getSignature, verifySignature } from "./common/crypto_util";
import DataStreamy from "./common/DataStreamy";
import { addByteCount, Address, byteCount, ByteCount, ChannelName, ChannelNodeInfo, createRequestId, durationGreaterThan, DurationMsec, elapsedSince, NodeId, nodeIdToPublicKey, nowTimestamp, scaledDurationMsec, unscaledDurationMsec, urlPath } from "./interfaces/core";
import { CheckAliveRequestData, DownloadFileDataRequestData, isCheckAliveResponseData, isNodeToNodeResponse, isStartStreamViaUdpResponseData, isStopStreamViaUdpResponseData, NodeToNodeRequest, NodeToNodeRequestData, NodeToNodeResponse, NodeToNodeResponseData, StartStreamViaUdpRequestData, StopStreamViaUdpRequestData, StreamId } from "./interfaces/NodeToNodeRequest";
import KacheryP2PNode from "./KacheryP2PNode";
import DownloadFileDataMethodOptimizer, { DownloadFileDataMethod } from "./methodOptimizers/DownloadFileDataMethodOptimizer";
import SendMessageMethodOptimizer from './methodOptimizers/SendMessageMethodOptimizer';
import { protocolVersion } from "./protocolVersion";
import { nodeIdFallbackAddress } from './services/PublicUdpSocketServer';

export type SendRequestMethod = 'default' | 'http' | 'http-proxy' | 'udp' | 'websocket' | 'prefer-udp' | 'prefer-http' | 'udp-fallback'

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
    #isBootstrapMessageProxy: boolean
    #isBootstrapDataProxy: boolean
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
    #sendMessageMethodOptimizer: SendMessageMethodOptimizer
    #downloadFileDataMethodOptimizer: DownloadFileDataMethodOptimizer
    constructor(node: KacheryP2PNode, remoteNodeId: NodeId, opts: {
        isBootstrap: boolean,
        isBootstrapMessageProxy: boolean,
        isBootstrapDataProxy: boolean,
        bootstrapAddress: Address | null,
        bootstrapWebSocketAddress: Address | null,
        bootstrapUdpSocketAddress: Address | null,
    } = {isBootstrap: false, isBootstrapMessageProxy: false, isBootstrapDataProxy: false, bootstrapAddress: null, bootstrapWebSocketAddress: null, bootstrapUdpSocketAddress: null}) {
        this.#node = node
        this.#remoteNodeId = remoteNodeId;
        this.#isBootstrap = opts.isBootstrap
        this.#isBootstrapMessageProxy = opts.isBootstrapMessageProxy,
        this.#isBootstrapDataProxy = opts.isBootstrapDataProxy,
        this.#bootstrapAddress = opts.bootstrapAddress
        this.#bootstrapWebSocketAddress = opts.bootstrapWebSocketAddress
        this.#bootstrapUdpSocketAddress = opts.bootstrapUdpSocketAddress
        this.#sendMessageMethodOptimizer = new SendMessageMethodOptimizer(this.#node, this)
        this.#downloadFileDataMethodOptimizer = new DownloadFileDataMethodOptimizer(this.#node, this)
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
    isMessageProxy(channelName: ChannelName | null) {
        if (channelName === null) {
            if (this.#isBootstrapMessageProxy) return true
            for (let cn of this.#node.channelNames()) {
                if (this.isMessageProxy(cn)) return true
            }
            return false
        }
        if (this.#isBootstrapMessageProxy) return true
        const cni = this.getChannelNodeInfo(channelName)
        if (!cni) return false
        return cni.body.isMessageProxy
    }
    isDataProxy(channelName: ChannelName | null) {
        if (channelName === null) {
            if (this.#isBootstrapDataProxy) return true
            for (let cn of this.#node.channelNames()) {
                if (this.isDataProxy(cn)) return true
            }
            return false
        }
        const cni = this.getChannelNodeInfo(channelName)
        if (!cni) return false
        return cni.body.isDataProxy
    }
    bootstrapAddress() {
        return this.#bootstrapAddress
    }
    bootstrapWebSocketAddress() {
        return this.#bootstrapWebSocketAddress
    }
    setChannelNodeInfoIfMoreRecent(channelName: ChannelName, channelNodeInfo: ChannelNodeInfo) {
        if (channelNodeInfoIsExpired(channelNodeInfo)) return
        if (this.#channelNodeInfoByChannel.has(channelName)) {
            const x = this.#channelNodeInfoByChannel.get(channelName);
            if (!x) throw Error('Unexpected.');
            if (x.body.timestamp > channelNodeInfo.body.timestamp) {
                // already have more recent
                return;
            }
        }
        if (!this.#isOnline) {
            // let's check to see if it is online
            const requestData: CheckAliveRequestData = {
                requestType: 'checkAlive'
            }
            this.sendRequest(requestData, channelName, {timeoutMsec: TIMEOUTS.defaultRequest, method: 'default'}).then(responseData => {
                if (!isCheckAliveResponseData(responseData)) throw Error('Unexpected response for checkAlive request')
                if (responseData.alive) {
                    this._setOnline(true)
                }
            }).catch(err => {
                // maybe not online
            })
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
        let ret = this.bootstrapWebSocketAddress()
        if (ret) return ret
        this.#channelNodeInfoByChannel.forEach((cni, channelName) => {
            if (cni.body.webSocketAddress) {
                ret = cni.body.webSocketAddress
            }
        })
        return ret
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
    ageOfChannelNodeInfo(channelName: ChannelName): DurationMsec | null {
        const cni = this.#channelNodeInfoByChannel.get(channelName)
        if (!cni) return null
        return unscaledDurationMsec(elapsedSince(cni.body.timestamp))
    }
    pruneChannelNodeInfos() {
        const channelNames = this.#channelNodeInfoByChannel.keys()
        for (let channelName of channelNames) {
            const cni = this.#channelNodeInfoByChannel.get(channelName)
            /* istanbul ignore next */
            if (!cni) throw Error('Unexpected in pruneChannelNodeInfos')
            if (channelNodeInfoIsExpired(cni)) {
                this.#channelNodeInfoByChannel.delete(channelName)
            }
        }
    }
    _formRequestFromRequestData(requestData: NodeToNodeRequestData, channelName: ChannelName, opts: {timeoutMsec: DurationMsec}): NodeToNodeRequest {
        const requestId = createRequestId()
        const requestBody = {
            protocolVersion: protocolVersion(),
            requestId,
            fromNodeId: this.#node.nodeId(),
            channelName,
            toNodeId: this.#remoteNodeId,
            timestamp: nowTimestamp(),
            timeoutMsec: opts.timeoutMsec,
            requestData
        }
        const request: NodeToNodeRequest = {
            body: requestBody,
            signature: getSignature(requestBody, this.#node.keyPair())
        }
        return request
    }
    getRemoteNodeHttpAddress(): Address | null {
        if (this.#isBootstrap && this.#bootstrapAddress) {
            return this.#bootstrapAddress
        }
        else {
            const channelNodeData = this._getMostRecentChannelNodeInfo()
            if (channelNodeData === null) {
                return null
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
    getRemoteNodeMessageProxyNode(channelName: ChannelName): RemoteNode | null {
        const channelNodeInfo = this.#channelNodeInfoByChannel.get(channelName)
        if (!channelNodeInfo) return null
        for (let proxyNodeId of channelNodeInfo.body.proxyWebsocketNodeIds) {
            if (proxyNodeId !== this.#remoteNodeId) {
                const prn = this.#node.remoteNodeManager().getRemoteNode(proxyNodeId)
                if (prn) {
                    if (prn.isMessageProxy(channelName)) { /////////////////////////// message proxy
                        if (prn.isOnline()) {
                            if (prn.getRemoteNodeHttpAddress()) {
                                return prn
                            }
                        }
                    }
                }
            }
        }
        return null
    }
    getRemoteNodeDataProxyNode(channelName: ChannelName): RemoteNode | null {
        const channelNodeInfo = this.#channelNodeInfoByChannel.get(channelName)
        if (!channelNodeInfo) return null
        for (let proxyNodeId of channelNodeInfo.body.proxyWebsocketNodeIds) {
            if (proxyNodeId !== this.#remoteNodeId) {
                const prn = this.#node.remoteNodeManager().getRemoteNode(proxyNodeId)
                if (prn) {
                    if (prn.isDataProxy(channelName)) { /////////////////////////// data proxy
                        if (prn.isOnline()) {
                            if (prn.getRemoteNodeHttpAddress()) {
                                return prn
                            }
                        }
                    }
                }
            }
        }
        return null
    }
    canSendRequest(method: SendRequestMethod, channelName: ChannelName): boolean {
        let method2 = this.#sendMessageMethodOptimizer.determineSendRequestMethod(method, channelName)
        return method2 === null ? false : true
    }
    async downloadFileData(streamId: StreamId, channelName: ChannelName, opts: {method: DownloadFileDataMethod}): Promise<{dataStream: DataStreamy, method: DownloadFileDataMethod}> {
        const method = this.#downloadFileDataMethodOptimizer.determineDownloadFileDataMethod(opts.method, channelName)
        if (method === null) {
            throw Error('No method available to download stream')
        }
        if (method === 'http') {
            const address = this.getRemoteNodeHttpAddress();
            if (!address) {
                throw Error('Unable to download file data... no http address found.')
            }
            const ds = await this.#node.externalInterface().httpGetDownload(address, urlPath(`/download/${this.remoteNodeId()}/${this.#node.nodeId()}/${streamId}`), this.#node.stats(), {fromNodeId: this.#remoteNodeId})
            return {
                method,
                dataStream: ds
            }
        }
        else if (method === 'http-proxy') {
            const proxyRemoteNode = this.getRemoteNodeDataProxyNode(channelName)
            if (!proxyRemoteNode) {
                /* istanbul ignore next */
                throw Error('Unexpected. Unable to download file data... no proxy remote node found.')
            }
            const address = proxyRemoteNode.getRemoteNodeHttpAddress()
            if (!address) {
                /* istanbul ignore next */
                throw Error('Unexpected. Unable to download file data... no http address for proxy remote node.')
            }
            const ds = await this.#node.externalInterface().httpGetDownload(address, urlPath(`/download/${this.remoteNodeId()}/${this.#node.nodeId()}/${streamId}`), this.#node.stats(), {fromNodeId: null})
            return {
                method,
                dataStream: ds
            }
        }
        else if (method === 'udp') {
            const ds = await this._streamDataViaUdpFromRemoteNode(streamId, channelName)
            return {
                method,
                dataStream: ds
            }
        }
        else {
            /* istanbul ignore next */
            throw Error ('Unexpected')
        }
    }
    async _streamDataViaUdpFromRemoteNode(streamId: StreamId, channelName: ChannelName): Promise<DataStreamy> {
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
        incomingDataStream.producer().onCancelled(() => {
            const stopReqData: StopStreamViaUdpRequestData = {
                requestType: "stopStreamViaUdp",
                streamId
            }
            this.sendRequest(stopReqData, channelName, {timeoutMsec: TIMEOUTS.defaultRequest, method: 'default'}).then(stopResponseData => {
                /* istanbul ignore next */
                if (!isStopStreamViaUdpResponseData(stopResponseData)) throw Error('Unexpected in _streamDataViaUdpFromRemoteNode')
                // okay
            }).catch(err => {
                throw Error(`Error sending request to stop stream via udp: ${err.message}`)
            })
        })
        try {
            const responseData = await this.sendRequest(requestData, channelName, {timeoutMsec: TIMEOUTS.defaultRequest, method: 'default'})
            /* istanbul ignore next */
            if (!isStartStreamViaUdpResponseData(responseData)) throw Error('Unexpected in _streamDataViaUdpFromRemoteNode')
            /* istanbul ignore next */
            if (!responseData.success) throw Error(`Error starting stream via udp: ${responseData.errorMessage}`)
        }
        catch(err) {
            incomingDataStream.producer().error(err)
        }
        return incomingDataStream
    }
    async startStreamViaUdpToRemoteNode(streamId: StreamId, channelName: ChannelName): Promise<void> {
        const r: DownloadFileDataRequestData | null = this.#node.downloadStreamManager().get(streamId)
        if (r === null) {
            /* istanbul ignore next */
            throw Error('Stream not found')
        }

        const udpS = this.#node.publicUdpSocketServer()
        const udpA = this.getUdpAddressForRemoteNode()
        /* istanbul ignore next */
        if (!udpS) throw Error('Cannot use stream via udp when there is no udp socket server')
        /* istanbul ignore next */
        if (!udpA) throw Error('Cannot stream via udp when there is no udp address')

        const ds = await this.#node.kacheryStorageManager().getFileReadStream(r.fileKey)
        const fallbackAddress = nodeIdFallbackAddress(this.#remoteNodeId)
        udpS.setOutgoingDataStream(udpA, fallbackAddress, streamId, ds, channelName, {toNodeId: this.#remoteNodeId})
    }
    async sendRequest(requestData: NodeToNodeRequestData, channelName: ChannelName, opts: {timeoutMsec: DurationMsec, method: SendRequestMethod }): Promise<NodeToNodeResponseData> {
        try {
            const ret = await this._trySendRequest(requestData, channelName, opts)
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
    async _trySendRequest(requestData: NodeToNodeRequestData, channelName: ChannelName, opts: {timeoutMsec: DurationMsec, method: SendRequestMethod }): Promise<NodeToNodeResponseData> {
        const request = this._formRequestFromRequestData(requestData, channelName, {timeoutMsec: opts.timeoutMsec});
        const requestId = request.body.requestId;

        const method = this.#sendMessageMethodOptimizer.determineSendRequestMethod(opts.method, channelName)
        if (method === null) {
            /* istanbul ignore next */
            throw Error(`Method not available for sending request ${requestData.requestType}: ${opts.method} (from ${this.#node.nodeId().slice(0, 6)} to ${this.#remoteNodeId.slice(0, 6)})`)
        }
        const requestSize = byteCount(JSON.stringify(request).length)
        this.#sendMessageMethodOptimizer.reportSendRequestStart(request.body.requestId, method, opts.timeoutMsec)

        let response: NodeToNodeResponse
        if ((method === 'http') || (method === 'http-proxy')) {
            let address: Address | null
            if (method === 'http') {
                address = this.getRemoteNodeHttpAddress()
                if (!address) {
                    /* istanbul ignore next */
                    throw Error('Unexpected. Unable to send request... no http address found.')
                }
            }
            else if (method === 'http-proxy') {
                const proxyRemoteNode = this.getRemoteNodeMessageProxyNode(channelName)
                if (!proxyRemoteNode) {
                    /* istanbul ignore next */
                    throw Error('Unexpected. Unable to send request... no proxy remote node found.')
                }
                address = proxyRemoteNode.getRemoteNodeHttpAddress()
                if (!address) {
                    /* istanbul ignore next */
                    throw Error('Unexpected. Unable to send request... no http address for proxy remote node.')
                }
            }
            else {
                /* istanbul ignore next */
                throw Error('Unexpected method in _trySendRequest')
            }
            this.#numHttpBytesSent = addByteCount(this.#numHttpBytesSent, requestSize)
            this.#numRequestsSent ++
            this.#node.stats().reportBytesSent('http', this.#remoteNodeId, byteCount(JSON.stringify(request).length))
            const R = await this.#node.externalInterface().httpPostJson(address, urlPath('/NodeToNodeRequest'), request, {timeoutMsec: opts.timeoutMsec});
            if (!isNodeToNodeResponse(R)) {
                // ban the node?
                /* istanbul ignore next */
                throw Error('Invalid response from node.');
            }
            this.#numResponsesReceived ++
            response = R
        }
        else if (method === 'udp') {
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
            const R = await udpS.sendRequest(udpA, request, channelName, {timeoutMsec: opts.timeoutMsec})
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
        else if (method === 'websocket') {
            const c1 = this.#node.getProxyConnectionToServer(this.#remoteNodeId)
            const c2 = this.#node.getProxyConnectionToClient(this.#remoteNodeId)
            if (c1) {
                response = await c1.sendRequest(request, {timeoutMsec: opts.timeoutMsec})
            }
            else if (c2) {
                response = await c2.sendRequest(request, {timeoutMsec: opts.timeoutMsec})
            }
            else {
                throw Error('Unexpected: no websocket proxy connection')
            }
        }
        else {
            /* istanbul ignore next */
            throw Error ('Unexpected')
        }
        this.#sendMessageMethodOptimizer.reportSendRequestEnd(request.body.requestId, method)
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
            /* istanbul ignore next */
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

export const channelNodeInfoIsExpired = (cni: ChannelNodeInfo) => {
    const elapsed = unscaledDurationMsec(elapsedSince(cni.body.timestamp))
    return (durationGreaterThan(elapsed, scaledDurationMsec(2 * 60 * 1000)))
}

export default RemoteNode;