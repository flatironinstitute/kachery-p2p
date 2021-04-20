import fs from 'fs'
import { nextTick } from 'process'
import ChannelConfigManager from './ChannelConfigManager'
import { ChannelConfig } from './cli'
import { createKeyPair, getSignature, hexToPrivateKey, hexToPublicKey, JSONStringifyDeterministic, privateKeyToHex, publicKeyToHex, verifySignature } from './common/crypto_util'
import DataStreamy from './common/DataStreamy'
import GarbageMap from './common/GarbageMap'
import { isReadableByOthers } from './common/util'
import DownloadOptimizer from './downloadOptimizer/DownloadOptimizer'
import ExternalInterface, { KacheryStorageManagerInterface } from './external/ExternalInterface'
import { MockNodeDefects } from './external/mock/MockNodeDaemon'
import FeedManager from './feeds/FeedManager'
import MutableManager from './mutables/MutableManager'
import Subfeed from './feeds/Subfeed'
import { getStats, GetStatsOpts } from './getStats'
import { addDurations, Address, byteCount, ChannelConfigUrl, ChannelInfo, ChannelNodeInfo, ChannelNodeInfoBody, DurationMsec, FeedId, FileKey, FindFileResult, FindLiveFeedResult, hostName, HostName, isKeyPair, JSONObject, KeyPair, LocalFilePath, messageCountToNumber, NodeId, nodeIdToPublicKey, NodeLabel, nowTimestamp, Port, publicKeyHexToNodeId, scaledDurationMsec, SignedSubfeedMessage, SubfeedHash, subfeedPositionToNumber, SubmittedSubfeedMessage, UrlString } from './interfaces/core'
import { CheckForFileRequestData, CheckForFileResponseData, CheckForLiveFeedRequestData, DownloadFileDataRequestData, DownloadSubfeedMessagesRequestData, isAnnounceRequestData, isCheckAliveRequestData, isCheckForFileRequestData, isCheckForFileResponseData, isCheckForLiveFeedRequestData, isCheckForLiveFeedResponseData, isDownloadFileDataRequestData, isDownloadSubfeedMessagesRequestData, isFallbackUdpPacketRequestData, isGetChannelInfoRequestData, isReportNewSubfeedMessagesRequestData, isStartStreamViaUdpRequestData, isSubmitMessageToLiveFeedRequestData, isSubmitMessageToLiveFeedResponseData, isSubscribeToSubfeedRequestData, NodeToNodeRequest, NodeToNodeResponse, NodeToNodeResponseData, StreamId, SubmitMessageToLiveFeedRequestData } from './interfaces/NodeToNodeRequest'
import NodeStats from './NodeStats'
import { handleCheckAliveRequest } from './nodeToNodeRequestHandlers/handleCheckAliveRequest'
import { handleCheckForFileRequest } from './nodeToNodeRequestHandlers/handleCheckForFileRequest'
import { handleCheckForLiveFeedRequest } from './nodeToNodeRequestHandlers/handleCheckForLiveFeedRequest'
import { handleDownloadFileDataRequest } from './nodeToNodeRequestHandlers/handleDownloadFileDataRequest'
import { handleDownloadSubfeedMessagesRequest } from './nodeToNodeRequestHandlers/handleDownloadSubfeedMessagesRequest'
import { handleFallbackUdpPacketRequest } from './nodeToNodeRequestHandlers/handleFallbackUdpPacketRequest'
import { handleGetChannelInfoRequest } from './nodeToNodeRequestHandlers/handleGetChannelInfoRequest'
import { handleReportNewSubfeedMessages } from './nodeToNodeRequestHandlers/handleReportSubfeedMessages'
import { handleStartStreamViaUdpRequest } from './nodeToNodeRequestHandlers/handleStartStreamViaUdpRequest'
import { handleSubmitMessageToLiveFeedRequest } from './nodeToNodeRequestHandlers/handleSubmitMessageToLiveFeedRequest'
import { handleSubscribeToSubfeed } from './nodeToNodeRequestHandlers/handleSubscribeToSubfeed'
import { protocolVersion } from './protocolVersion'
import { ProxyWebsocketConnection } from './proxyConnections/ProxyWebsocketConnection'
import RemoteNode from './RemoteNode'
import RemoteNodeManager from './RemoteNodeManager'
import { JoinedChannelConfig, MirrorSourceConfig } from './services/ConfigUpdateService'
import PublicUdpSocketServer from './services/PublicUdpSocketServer'
import { PacketId } from './udp/UdpPacketSender'

export interface KacheryP2PNodeOpts {
    isBootstrapNode: boolean
    multicastUdpAddress: Address | null
    getDefects: () => MockNodeDefects
}

class KacheryP2PNode {
    #keyPair: KeyPair
    #nodeId: NodeId
    #joinedChannels: JoinedChannelConfig[] = []
    #feedManager: FeedManager
    #mutableManager: MutableManager
    #remoteNodeManager: RemoteNodeManager
    #kacheryStorageManager: KacheryStorageManagerInterface
    #channelConfigManager = new ChannelConfigManager()
    #proxyConnectionsToClients = new Map<NodeId, ProxyWebsocketConnection>()
    #proxyConnectionsToServers = new Map<NodeId, ProxyWebsocketConnection>()
    #downloadStreamManager = new DownloadStreamManager
    #publicUdpSocketAddress: Address | null = null
    #publicUdpSocketServer: PublicUdpSocketServer | null = null
    #downloadOptimizer: DownloadOptimizer
    #onProxyConnectionToServerCallbacks: (() => void)[] = []
    #stats = new NodeStats()
    #mirrorSources: MirrorSourceConfig[] = []
    #clientAuthCode = {current: '', previous: ''}
    constructor(private p: {
        configDir: LocalFilePath | null, // no longer used, but include for migration
        verbose: number,
        hostName: HostName | null,
        publicUrl: UrlString | null,
        httpListenPort: Port | null,
        udpSocketPort: Port | null,
        webSocketListenPort: Port | null,
        label: NodeLabel,
        externalInterface: ExternalInterface,
        opts: KacheryP2PNodeOpts
    }) {
        this.#kacheryStorageManager = p.externalInterface.createKacheryStorageManager()

        if ((p.configDir) && (fs.existsSync(`${p.configDir.toString()}/private.pem`))) {
            migrateKeypairToStorageDir(p.configDir, this.#kacheryStorageManager.storageDir())
        }

        this.#keyPair = this.#kacheryStorageManager.storageDir() ? _loadKeypair(this.#kacheryStorageManager.storageDir()) : createKeyPair()
        this.#nodeId = publicKeyHexToNodeId(publicKeyToHex(this.#keyPair.publicKey)) // get the node id from the public key

        const storageDir = this.#kacheryStorageManager.storageDir()
        this.#mutableManager = new MutableManager(storageDir)

        // The feed manager -- each feed is a collection of append-only logs
        const localFeedManager = this.p.externalInterface.createLocalFeedManager(this.#mutableManager)
        this.#feedManager = new FeedManager(this, localFeedManager)

        this.#remoteNodeManager = new RemoteNodeManager(this)

        this.#downloadOptimizer = new DownloadOptimizer(this)
    }
    nodeId() {
        return this.#nodeId
    }
    keyPair() {
        return this.#keyPair
    }
    joinedChannels() {
        return [...this.#joinedChannels]
    }
    joinedChannelConfigUrls() {
        return this.#joinedChannels.map(x => (x.channelConfigUrl))
    }
    hasJoinedChannel(channelConfigUrl: ChannelConfigUrl) {
        return (this.#joinedChannels.filter(x => (x.channelConfigUrl === channelConfigUrl)).length > 0)
    }
    setJoinedChannels(x: JoinedChannelConfig[]) {
        this.#joinedChannels = x
    }
    setMirrorSources(x: MirrorSourceConfig[]) {
        this.#mirrorSources = x
    }
    mirrorSources() {
        return [...this.#mirrorSources]
    }
    remoteNodeManager() {
        return this.#remoteNodeManager
    }
    isBootstrapNode() {
        return this.p.opts.isBootstrapNode
    }
    useMulticastUdp() {
        return (this.p.opts.multicastUdpAddress !== null)
    }
    kacheryStorageManager() {
        return this.#kacheryStorageManager
    }
    downloadStreamManager(): DownloadStreamManager {
        return this.#downloadStreamManager
    }
    downloadOptimizer(): DownloadOptimizer {
        return this.#downloadOptimizer
    }
    getDefects() {
        return this.p.opts.getDefects()
    }
    stats() {
        return this.#stats
    }
    async getChannelConfig(channelConfigUrl: ChannelConfigUrl): Promise<ChannelConfig | null> {
        return await this.#channelConfigManager.getChannelConfig(channelConfigUrl)
    }
    getChannelConfigSync(channelConfigUrl: ChannelConfigUrl): ChannelConfig | null {
        return this.#channelConfigManager.getChannelConfigSync(channelConfigUrl)
    }
    nodeIsAuthorizedOnChannel(nodeId: NodeId, channelConfigUrl: ChannelConfigUrl): boolean {
        const channelConfig = this.getChannelConfigSync(channelConfigUrl)
        if (!channelConfig) return false
        if (channelConfig.authorizedNodes.find(an => (an.nodeId === nodeId))) return true
        else return false
    }
    nodeIsOnChannel(nodeId: NodeId, channelConfigUrl: ChannelConfigUrl): boolean {
        if (nodeId === this.#nodeId) {
            return this.#joinedChannels.find(a => (a.channelConfigUrl === channelConfigUrl)) ? true : false
        }
        else {
            const rn = this.#remoteNodeManager.getRemoteNode(nodeId)
            if (!rn) return false
            return rn.getJoinedChannelConfigUrls().find(u => (u === channelConfigUrl)) ? true : false
        }
    }
    nodeIsPublicOnChannel(nodeId: NodeId, channelConfigUrl: ChannelConfigUrl): boolean {
        const channelConfig = this.getChannelConfigSync(channelConfigUrl)
        if (!channelConfig) return false
        const x = channelConfig.authorizedNodes.find(an => (an.nodeId === nodeId))
        if (!x) return false
        if (!x.isPublic) return false
        if (nodeId === this.#nodeId) {
            const joinedChannelConfig = this.#joinedChannels.find(a => (a.channelConfigUrl === channelConfigUrl))
            if (!joinedChannelConfig) return false
            return joinedChannelConfig.isPublic ? true : false
        }
        else {
            const remoteChannelNodeInfo = this.getRemoteChannelNodeInfo(nodeId, channelConfigUrl)
            if (!remoteChannelNodeInfo) return false
            if (remoteChannelNodeInfo.body.isPublic) return true
        }
        return false
    }
    findFile(args: { fileKey: FileKey, timeoutMsec: DurationMsec}): {
        onFound: (callback: (result: FindFileResult) => void) => void,
        onFinished: (callback: () => void) => void,
        cancel: () => void
    } {
        let onFoundCallbacks: ((result: FindFileResult) => void)[] = []
        let onFinishedCallbacks: (() => void)[] = []
        let cancelled = false
        let handleCancel: (() => void) | null = null
        setTimeout(() => { // hmmmm
            if (cancelled) return
            const requestData: CheckForFileRequestData = {
                requestType: 'checkForFile',
                fileKey: args.fileKey
            }

            // first check on this node
            handleCheckForFileRequest(this, this.#nodeId, requestData).then((thisResponse: CheckForFileResponseData) => {
                const s = thisResponse.size
                if ((thisResponse.found) && (s !== null)) {
                    onFoundCallbacks.forEach(cb => {
                        cb({
                            nodeId: this.#nodeId,
                            fileKey: args.fileKey,
                            fileSize: s
                        })
                    })
                }

                const { onResponse, onFinished, onErrorResponse, cancel } = this.#remoteNodeManager.sendRequestToAllNodes(requestData, { timeoutMsec: args.timeoutMsec })
                handleCancel = cancel
                onResponse((nodeId: NodeId, responseData: NodeToNodeResponseData) => {
                    if (!isCheckForFileResponseData(responseData)) {
                        /* istanbul ignore next */
                        throw Error(`Unexpected response type: ${responseData.requestType} <> 'checkForFile'`)
                    }
                    const { found, size } = responseData
                    if ((found) && (size !== null)) {
                        onFoundCallbacks.forEach(cb => {
                            cb({
                                nodeId,
                                fileKey: args.fileKey,
                                fileSize: size
                            })
                        })
                    }
                })
                onFinished(() => {
                    onFinishedCallbacks.forEach(cb => {
                        cb()
                    })
                })
                onErrorResponse((nodeId: NodeId, err: Error) => {
                    // todo
                })

            }).catch((err) => {
                throw Error('Unexpected problem trying to find file on local node')
            })
        }, 10)
        return {
            onFound: (cb) => {
                onFoundCallbacks.push(cb)
            },
            onFinished: (cb) => {
                onFinishedCallbacks.push(cb)
            },
            cancel: () => {
                if (cancelled) return
                handleCancel && handleCancel()
            }
        }
    }
    cleanup() {
        this.#proxyConnectionsToClients.forEach(c => {
            c.close()
        })
        this.#proxyConnectionsToClients.clear()
        this.#proxyConnectionsToServers.forEach(c => {
            c.close()
        })
        this.#proxyConnectionsToServers.clear()
    }
    externalInterface() {
        return this.p.externalInterface
    }
    feedManager() {
        return this.#feedManager
    }
    mutableManager() {
        return this.#mutableManager
    }
    setProxyConnectionToClient(nodeId: NodeId, c: ProxyWebsocketConnection) {
        if (this.#proxyConnectionsToClients.has(nodeId)) {
            // we already have this connection
            c.close()
            return
        }
        this.#proxyConnectionsToClients.set(nodeId, c)
        c.onClosed(() => {
            if (this.#proxyConnectionsToClients.get(nodeId) === c) {
                this.#proxyConnectionsToClients.delete(nodeId)
            }
        })
    }
    setProxyConnectionToServer(nodeId: NodeId, c: ProxyWebsocketConnection) {
        if (this.#proxyConnectionsToServers.has(nodeId)) {
            // we already have this connection
            c.close()
            return
        }
        this.#proxyConnectionsToServers.set(nodeId, c)
        c.onClosed(() => {
            if (this.#proxyConnectionsToServers.get(nodeId) === c) {
                this.#proxyConnectionsToServers.delete(nodeId)
            }
        })
        this.#onProxyConnectionToServerCallbacks.forEach(cb => { cb() })
    }
    onProxyConnectionToServer(callback: (() => void)) {
        this.#onProxyConnectionToServerCallbacks.push(callback)
    }
    getProxyConnectionToServer(nodeId: NodeId) {
        return this.#proxyConnectionsToServers.get(nodeId) || null
    }
    getProxyConnectionToClient(nodeId: NodeId) {
        return this.#proxyConnectionsToClients.get(nodeId) || null
    }
    getChannelInfo(channelConfigUrl: ChannelConfigUrl): ChannelInfo {
        const remoteNodesInChannel: RemoteNode[] = this.#remoteNodeManager.getRemoteNodesInChannel(channelConfigUrl, {includeOffline: false})
        const x: ChannelInfo = {
            nodes: remoteNodesInChannel.map(n => {
                return n.getRemoteChannelNodeInfo(channelConfigUrl)
            }).filter(channelInfo => (channelInfo !== null))
            .map(channelInfo => {
                if (channelInfo === null) {
                    throw Error('Unexpected channelInfo === null should have been filtered out')
                }
                return channelInfo
            })
        }
        return x
    }
    hostName(): HostName | null {
        if (this.p.hostName) return this.p.hostName
        if (this.p.externalInterface.isMock) {
            return hostName(this.nodeId().toString())
        }
        else {
            /* istanbul ignore next */
            return null
        }
    }
    publicUrl(): UrlString | null {
        return this.p.publicUrl
    }
    httpAddress(): Address | null {
        const u = this.publicUrl()
        if (u) {
            return {
                url: u
            }
        }
        else {
            const h = this.hostName()
            return (h !== null) && (this.p.httpListenPort !== null) ? { hostName: h, port: this.p.httpListenPort } : null
        }
    }
    webSocketAddress(): Address | null {
        const h = this.hostName()
        return (h !== null) && (this.p.webSocketListenPort !== null) ? { hostName: h, port: this.p.webSocketListenPort } : null
    }
    udpSocketPort() {
        return this.p.udpSocketPort
    }
    publicUdpSocketAddress(): Address | null {
        if (this.#publicUdpSocketAddress !== null) {
            return this.#publicUdpSocketAddress
        }
        else {
            const h = this.hostName()
            if ((h !== null) && (this.p.udpSocketPort !== null)) {
                return {
                    hostName: h,
                    port: this.p.udpSocketPort
                }
            }
            else {
                return null
            }
        }
    }
    setPublicUdpSocketAddress(a: Address) {
        this.#publicUdpSocketAddress = a
    }
    setPublicUdpSocketServer(s: PublicUdpSocketServer) {
        this.#publicUdpSocketServer = s
    }
    publicUdpSocketServer() {
        return this.#publicUdpSocketServer
    }
    getJoinedChannelConfig(channelConfigUrl: ChannelConfigUrl): JoinedChannelConfig | undefined {
        return this.#joinedChannels.find(x => (x.channelConfigUrl === channelConfigUrl))
    }
    getRemoteChannelNodeInfo(nodeId: NodeId, channelConfigUrl: ChannelConfigUrl): ChannelNodeInfo | null {
        const rn = this.#remoteNodeManager.getRemoteNode(nodeId)
        if (!rn) return null
        return rn.getRemoteChannelNodeInfo(channelConfigUrl)
    }
    async getChannelNodeInfo(channelConfigUrl: ChannelConfigUrl): Promise<ChannelNodeInfo> {
        const channelConfig = await this.getChannelConfig(channelConfigUrl)
        const joinedChannelConfig = this.getJoinedChannelConfig(channelConfigUrl)
        if (!joinedChannelConfig) {
            console.warn('Unexpected: joinedChannelConfig is not defined in getChannelNodeInfo')
        }
        const messageProxyWebsocketNodeIds: NodeId[] = []
        const dataProxyWebsocketNodeIds: NodeId[] = []
        if (channelConfig) {
            channelConfig.authorizedNodes.forEach(an => {
                if ((an.isMessageProxy) || (an.isDataProxy)) {
                    const rcni = this.getRemoteChannelNodeInfo(an.nodeId, channelConfigUrl)
                    if (rcni) {
                        if ((rcni.body.isMessageProxy) && (an.isMessageProxy)) {
                            if (this.#proxyConnectionsToServers.has(an.nodeId)) {
                                messageProxyWebsocketNodeIds.push(an.nodeId)
                            }
                        }
                        if ((rcni.body.isDataProxy) && (an.isDataProxy)) {
                            if (this.#proxyConnectionsToServers.has(an.nodeId)) {
                                dataProxyWebsocketNodeIds.push(an.nodeId)
                            }
                        }
                    }
                }
            })
        }
        const body: ChannelNodeInfoBody = {
            channelConfigUrl,
            nodeId: this.#nodeId,
            nodeLabel: this.p.label,
            httpAddress: this.httpAddress(),
            webSocketAddress: this.webSocketAddress(),
            publicUdpSocketAddress: this.#publicUdpSocketAddress,
            isMessageProxy: joinedChannelConfig ? joinedChannelConfig.isMessageProxy : undefined,
            isDataProxy: joinedChannelConfig ? joinedChannelConfig.isDataProxy : undefined,
            isPublic: joinedChannelConfig ? joinedChannelConfig.isPublic : undefined,
            messageProxyWebsocketNodeIds,
            dataProxyWebsocketNodeIds,
            timestamp: nowTimestamp()
        }
        return {
            body,
            signature: getSignature(body, this.#keyPair)
        }
    }
    async submitMessageToRemoteLiveFeed({ nodeId, feedId, subfeedHash, message, timeoutMsec }: {
        nodeId: NodeId,
        feedId: FeedId,
        subfeedHash: SubfeedHash,
        message: SubmittedSubfeedMessage,
        timeoutMsec: DurationMsec
    }) {
        const requestData: SubmitMessageToLiveFeedRequestData = {
            requestType: 'submitMessageToLiveFeed',
            feedId,
            subfeedHash,
            message
        }
        const responseData = await this.#remoteNodeManager.sendRequestToNode(nodeId, requestData, { timeoutMsec: timeoutMsec, method: 'default' })
        if (!isSubmitMessageToLiveFeedResponseData(responseData)) {
            /* istanbul ignore next */
            throw Error(`Error submitting message to remote live feed: Unexpected response data.`)
        }
        if (!responseData.success) {
            throw Error(`Error submitting message to remote live feed: ${responseData.errorMessage}`)
        }
    }
    async findLiveFeed(args: {
        feedId: FeedId,
        timeoutMsec: DurationMsec
    }): Promise<FindLiveFeedResult | null> {
        const { feedId, timeoutMsec } = args
        return new Promise<FindLiveFeedResult | null>((resolve, reject) => {
            const requestData: CheckForLiveFeedRequestData = {
                requestType: 'checkForLiveFeed',
                feedId
            }
            const { onResponse, onFinished, onErrorResponse, cancel } = this.#remoteNodeManager.sendRequestToAllNodes(requestData, { timeoutMsec })
            let found = false
            onResponse((nodeId, responseData) => {
                if (found) return
                if (!isCheckForLiveFeedResponseData(responseData)) {
                    /* istanbul ignore next */
                    throw Error('Unexpected response type.')
                }
                if (responseData.found) {
                    found = true
                    resolve({
                        nodeId
                    })
                }
            })
            onFinished(() => {
                if (!found) {
                    resolve(null)
                }
            })
            onErrorResponse((nodeId: NodeId, error: Error) => {
                // todo
            })
        })
    }
    async handleNodeToNodeRequest(request: NodeToNodeRequest): Promise<NodeToNodeResponse> {
        const { requestId, fromNodeId, toNodeId, timestamp, requestData } = request.body
        if (!verifySignature(request.body, request.signature, nodeIdToPublicKey(fromNodeId))) {
            // think about banning the node here
            /* istanbul ignore next */
            throw Error('Invalid signature in node-to-node request')
        }
        if (toNodeId !== this.#nodeId) {
            // redirect request to a different node
            const p = this.#proxyConnectionsToClients.get(toNodeId)
            if (!p) {
                throw Error(`No proxy connection to node: ${fromNodeId.slice(0, 6)} -> ${toNodeId.slice(0, 6)}`)
            }
            return await p.sendRequest(request, {timeoutMsec: addDurations(request.body.timeoutMsec, scaledDurationMsec(1000))})
        }

        let responseData: NodeToNodeResponseData
        if (isCheckAliveRequestData(requestData)) {
            responseData = await handleCheckAliveRequest(this, fromNodeId, requestData)
        }
        else if (isGetChannelInfoRequestData(requestData)) {
            responseData = await handleGetChannelInfoRequest(this, fromNodeId, requestData)
        }
        else if (isAnnounceRequestData(requestData)) {
            responseData = await this.remoteNodeManager().handleAnnounceRequest({ fromNodeId, requestData, localUdpAddress: null })
        }
        else if (isCheckForFileRequestData(requestData)) {
            responseData = await handleCheckForFileRequest(this, fromNodeId, requestData)
        }
        else if (isCheckForLiveFeedRequestData(requestData)) {
            responseData = await handleCheckForLiveFeedRequest(this, fromNodeId, requestData)
        }
        else if (isSubscribeToSubfeedRequestData(requestData)) {
            responseData = await handleSubscribeToSubfeed(this, fromNodeId, requestData)
        }
        else if (isReportNewSubfeedMessagesRequestData(requestData)) {
            responseData = await handleReportNewSubfeedMessages(this, fromNodeId, requestData)
        }
        else if (isDownloadFileDataRequestData(requestData)) {
            responseData = await handleDownloadFileDataRequest(this, fromNodeId, requestData)
        }
        else if (isDownloadSubfeedMessagesRequestData(requestData)) {
            responseData = await handleDownloadSubfeedMessagesRequest(this, fromNodeId, requestData)
        }
        else if (isSubmitMessageToLiveFeedRequestData(requestData)) {
            responseData = await handleSubmitMessageToLiveFeedRequest(this, fromNodeId, requestData)
        }
        else if (isStartStreamViaUdpRequestData(requestData)) {
            responseData = await handleStartStreamViaUdpRequest(this, fromNodeId, requestData)
        }
        else if (isFallbackUdpPacketRequestData(requestData)) {
            responseData = await handleFallbackUdpPacketRequest(this, fromNodeId, requestData)
        }
        else {
            /* istanbul ignore next */
            {
                console.warn(requestData)
                throw Error('Unexpected error: unrecognized request data.')
            }
        }
        const body = {
            protocolVersion: protocolVersion(),
            requestId,
            fromNodeId: this.#nodeId,
            toNodeId: fromNodeId,
            timestamp: nowTimestamp(),
            responseData: responseData
        }
        return {
            body,
            signature: getSignature(body, this.#keyPair)
        }
    }
    async streamDataForStreamId(fromNodeId: NodeId, streamId: StreamId): Promise<DataStreamy> {
        if (fromNodeId !== this.#nodeId) {
            // redirect to a different node
            const p = this.#proxyConnectionsToClients.get(fromNodeId)
            if (!p) {
                /* istanbul ignore next */
                throw Error(`No proxy connection to node: ${fromNodeId.slice(0, 6)} <> ${this.#nodeId.slice(0, 6)}`)
            }
            return p.streamDataForStreamId(streamId)
        }

        const s = this.#downloadStreamManager.get(streamId)
        if (!s) {
            /* istanbul ignore next */
            throw Error(`Unable to find download info for stream: ${streamId}: (node: ${this.#nodeId.slice(0, 6)})`)
        }
        if (isDownloadFileDataRequestData(s)) {
            const { startByte, endByte } = s
            /* istanbul ignore next */
            if (endByte === null) throw Error('Unexpected in streamDataForStreamId')
            const ret = new DataStreamy();
            const dataStream = await this.#kacheryStorageManager.getFileReadStream(s.fileKey)
            ret.producer().onCancelled(() => {
                dataStream.cancel()
            })
            try {
                dataStream.onStarted(size => { ret.producer().start(size) })
                dataStream.onData(b => { ret.producer().data(b) })
                dataStream.onFinished(() => { ret.producer().end() })
                dataStream.onError(err => { ret.producer().error(err) })
            }
            catch (err) {
                ret.producer().error(err)
            }
            return ret
        }
        else if (isDownloadSubfeedMessagesRequestData(s)) {
            const ret = new DataStreamy();
            const { feedId, subfeedHash, position, numMessages } = s
            let subfeed: Subfeed
            try {
                subfeed = await this.feedManager()._loadSubfeed(feedId, subfeedHash)
            }
            catch(err) {
                ret.producer().error(new Error('Problem loading subfeed'))
                return ret
            }
            const numLocalMessages = subfeed.getNumLocalMessages()
            if (messageCountToNumber(numLocalMessages) < subfeedPositionToNumber(s.position) + messageCountToNumber(s.numMessages)) {
                ret.producer().error(new Error('Not enough subfeed messages locally'))
                return ret
            }
            let signedMessages: SignedSubfeedMessage[]
            try {
                signedMessages = subfeed.getLocalSignedMessages({position, numMessages})
            }
            catch(err) {
                ret.producer().error(new Error('Problem loading signed messages'))
                return ret
            }
            nextTick(() => {
                const x = Buffer.from(JSONStringifyDeterministic(signedMessages))
                ret.producer().start(byteCount(x.byteLength))
                ret.producer().data(x)
                ret.producer().end()
            })
            return ret
        }
        else {
            throw Error('Unexpected')
        }
    }
    receiveFallbackUdpPacket(fromNodeId: NodeId, packetId: PacketId, packet: Buffer): void {
        if (!this.#publicUdpSocketServer) {
            /* istanbul ignore next */
            throw Error(`Cannot receive fallback udp packet from ${fromNodeId.slice(0, 6)}. No public udp socket server set.`)
        }
        this.#publicUdpSocketServer.receiveFallbackUdpPacket(fromNodeId, packetId, packet)
    }
    getStats(o: GetStatsOpts) {
        return getStats(this, o)
    }
    nodeLabel() {
        return this.p.label
    }
    setClientAuthCode(code: string, previousCode: string) {
        this.#clientAuthCode = {
            current: code,
            previous: previousCode
        }
    }
    verifyClientAuthCode(code: string) {
        if (code === this.#clientAuthCode.current) return true
        if ((this.#clientAuthCode.previous) && (code === this.#clientAuthCode.previous)) return true
        return false
    }
}

const migrateKeypairToStorageDir = (configDir: LocalFilePath, storageDir: LocalFilePath) => {
    const oldPublicKeyPath = `${configDir.toString()}/public.pem`
    const oldPrivateKeyPath = `${configDir.toString()}/private.pem`
    const newPublicKeyPath = `${storageDir.toString()}/public.pem`
    const newPrivateKeyPath = `${storageDir.toString()}/private.pem`
    if (fs.existsSync(newPublicKeyPath)) {
        throw Error(`Unexpected problem migrating keypair. File exists: ${newPublicKeyPath}`)
    }
    if (fs.existsSync(newPrivateKeyPath)) {
        throw Error(`Unexpected problem migrating keypair. File exists: ${newPrivateKeyPath}`)
    }
    if (!fs.existsSync(oldPublicKeyPath)) {
        throw Error(`Unexpected problem migrating keypair. File does not exists: ${oldPublicKeyPath}`)
    }
    if (!fs.existsSync(oldPrivateKeyPath)) {
        throw Error(`Unexpected problem migrating keypair. File exists: ${oldPrivateKeyPath}`)
    }
    console.info('Migrating keypair to kachery storage directory')
    fs.renameSync(oldPublicKeyPath, newPublicKeyPath)
    fs.renameSync(oldPrivateKeyPath, newPrivateKeyPath)
    fs.chmodSync(newPublicKeyPath, fs.constants.S_IRUSR | fs.constants.S_IWUSR)
    fs.chmodSync(newPrivateKeyPath, fs.constants.S_IRUSR | fs.constants.S_IWUSR)
}

class DownloadStreamManager {
    #downloadStreamInfos = new GarbageMap<StreamId, DownloadFileDataRequestData | DownloadSubfeedMessagesRequestData>(scaledDurationMsec(30 * 60 * 1000))
    set(streamId: StreamId, info: DownloadFileDataRequestData | DownloadSubfeedMessagesRequestData) {
        this.#downloadStreamInfos.set(streamId, info)
    }
    get(streamId: StreamId): DownloadFileDataRequestData | DownloadSubfeedMessagesRequestData | null {
        return this.#downloadStreamInfos.get(streamId) || null
    }
}

const _loadKeypair = (storageDir: LocalFilePath): KeyPair => {
    if (!fs.existsSync(storageDir.toString())) {
        /* istanbul ignore next */
        throw Error(`Storage directory does not exist: ${storageDir}`)
    }
    const publicKeyPath = `${storageDir.toString()}/public.pem`
    const privateKeyPath = `${storageDir.toString()}/private.pem`
    if (fs.existsSync(publicKeyPath)) {
        /* istanbul ignore next */
        if (!fs.existsSync(privateKeyPath)) {
            throw Error(`Public key file exists, but secret key file does not.`)
        }
    }
    else {
        const { publicKey, privateKey } = createKeyPair()
        fs.writeFileSync(publicKeyPath, publicKey.toString(), { encoding: 'utf-8' })
        fs.writeFileSync(privateKeyPath, privateKey.toString(), { encoding: 'utf-8', mode: fs.constants.S_IRUSR | fs.constants.S_IWUSR})
        fs.chmodSync(publicKeyPath, fs.constants.S_IRUSR | fs.constants.S_IWUSR)
        fs.chmodSync(privateKeyPath, fs.constants.S_IRUSR | fs.constants.S_IWUSR)
    }

    if (isReadableByOthers(privateKeyPath)) {
        throw Error(`Invalid permissions for private key file: ${privateKeyPath}`)
    }

    const keyPair = {
        publicKey: fs.readFileSync(publicKeyPath, { encoding: 'utf-8' }),
        privateKey: fs.readFileSync(privateKeyPath, { encoding: 'utf-8' }),
    }
    if (!isKeyPair(keyPair)) {
        /* istanbul ignore next */
        throw Error('Invalid keyPair')
    }
    testKeyPair(keyPair)
    return keyPair
}

const testKeyPair = (keyPair: KeyPair) => {
    const signature = getSignature({ test: 1 }, keyPair)
    if (!verifySignature({ test: 1 } as JSONObject, signature, keyPair.publicKey)) {
        /* istanbul ignore next */
        throw new Error('Problem testing public/private keys. Error verifying signature.')
    }
    if (hexToPublicKey(publicKeyToHex(keyPair.publicKey)) !== keyPair.publicKey) {
        /* istanbul ignore next */
        throw new Error('Problem testing public/private keys. Error converting public key to/from hex.')
    }
    if (hexToPrivateKey(privateKeyToHex(keyPair.privateKey)) !== keyPair.privateKey) {
        /* istanbul ignore next */
        throw new Error('Problem testing public/private keys. Error converting private key to/from hex.')
    }
}

export default KacheryP2PNode