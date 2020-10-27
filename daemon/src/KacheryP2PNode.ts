import fs from 'fs'
import { createKeyPair, getSignature, hexToPrivateKey, hexToPublicKey, privateKeyToHex, publicKeyToHex, verifySignature } from './common/crypto_util'
import DataStreamy from './common/DataStreamy'
import GarbageMap from './common/GarbageMap'
import DownloaderCreator from './downloadOptimizer/DownloaderCreator'
import DownloadOptimizer from './downloadOptimizer/DownloadOptimizer'
import ExternalInterface, { KacheryStorageManagerInterface } from './external/ExternalInterface'
import { MockNodeDefects } from './external/mock/MockNodeDaemon'
import FeedManager from './feeds/FeedManager'
import { LiveFeedSubscriptionManager } from './feeds/LiveFeedSubscriptionManager'
import { addDurations, Address, ChannelName, ChannelNodeInfo, DurationMsec, FeedId, FileKey, FindFileResult, FindLiveFeedResult, hostName, HostName, isKeyPair, JSONObject, KeyPair, LocalFilePath, MessageCount, NodeId, nodeIdToPublicKey, nowTimestamp, Port, publicKeyHexToNodeId, scaledDurationMsec, SignedSubfeedMessage, SubfeedHash, SubfeedPosition, SubmittedSubfeedMessage } from './interfaces/core'
import { CheckForFileRequestData, CheckForLiveFeedRequestData, DownloadFileDataRequestData, GetLiveFeedSignedMessagesRequestData, isAnnounceRequestData, isCheckForFileRequestData, isCheckForFileResponseData, isCheckForLiveFeedRequestData, isCheckForLiveFeedResponseData, isDownloadFileDataRequestData, isFallbackUdpPacketRequestData, isGetChannelInfoRequestData, isGetLiveFeedSignedMessagesRequestData, isGetLiveFeedSignedMessagesResponseData, isSetLiveFeedSubscriptionsRequestData, isStartStreamViaUdpRequestData, isSubmitMessageToLiveFeedRequestData, isSubmitMessageToLiveFeedResponseData, NodeToNodeRequest, NodeToNodeResponse, NodeToNodeResponseData, StreamId, SubmitMessageToLiveFeedRequestData } from './interfaces/NodeToNodeRequest'
import { handleCheckForFileRequest } from './nodeToNodeRequestHandlers/handleCheckForFileRequest'
import { handleCheckForLiveFeedRequest } from './nodeToNodeRequestHandlers/handleCheckForLiveFeedRequest'
import { handleDownloadFileDataRequest } from './nodeToNodeRequestHandlers/handleDownloadFileDataRequest'
import { handleFallbackUdpPacketRequest } from './nodeToNodeRequestHandlers/handleFallbackUdpPacketRequest'
import { handleGetChannelInfoRequest } from './nodeToNodeRequestHandlers/handleGetChannelInfoRequest'
import { handleGetLiveFeedSignedMessagesRequest } from './nodeToNodeRequestHandlers/handleGetLiveFeedSignedMessagesRequest'
import { handleSetLiveFeedSubscriptionsRequest } from './nodeToNodeRequestHandlers/handleSetLiveFeedSubscriptionsRequest'
import { handleStartStreamViaUdpRequest } from './nodeToNodeRequestHandlers/handleStartStreamViaUdpRequest'
import { handleSubmitMessageToLiveFeedRequest } from './nodeToNodeRequestHandlers/handleSubmitMessageToLiveFeedRequest'
import { protocolVersion } from './protocolVersion'
import { ProxyConnectionToClient } from './proxyConnections/ProxyConnectionToClient'
import { ProxyConnectionToServer } from './proxyConnections/ProxyConnectionToServer'
import RemoteNodeManager from './RemoteNodeManager'
import PublicUdpSocketServer from './services/PublicUdpSocketServer'
import { PacketId } from './udp/UdpPacketSender'

export interface KacheryP2PNodeOpts {
    isBootstrapNode: boolean,
    multicastUdpAddress: Address | null,
    getDefects: () => MockNodeDefects
}

class KacheryP2PNode {
    #keyPair: KeyPair
    #nodeId: NodeId
    #feedManager: FeedManager
    #remoteNodeManager: RemoteNodeManager
    #kacheryStorageManager: KacheryStorageManagerInterface
    #liveFeedSubscriptionManager: LiveFeedSubscriptionManager // not used right now
    #proxyConnectionsToClients = new Map<NodeId, ProxyConnectionToClient>()
    #proxyConnectionsToServers = new Map<NodeId, ProxyConnectionToServer>()
    #downloadStreamManager = new DownloadStreamManager
    #publicUdpSocketAddress: Address | null = null
    #publicUdpSocketServer: PublicUdpSocketServer | null = null
    #downloadOptimizer: DownloadOptimizer
    #onProxyConnectionToServerCallbacks: (() => void)[] = []
    constructor(private p: {
        configDir: LocalFilePath | null,
        verbose: number,
        hostName: HostName | null,
        httpListenPort: Port | null,
        udpSocketPort: Port | null,
        webSocketListenPort: Port | null,
        label: string,
        bootstrapAddresses: Address[],
        channelNames: ChannelName[],
        externalInterface: ExternalInterface,
        opts: KacheryP2PNodeOpts
    }) {
        this.#keyPair = p.configDir !== null ? _loadKeypair(p.configDir) : createKeyPair()
        this.#nodeId = publicKeyHexToNodeId(publicKeyToHex(this.#keyPair.publicKey)) // get the node id from the public key
        this.#kacheryStorageManager = p.externalInterface.createKacheryStorageManager()
        this.#liveFeedSubscriptionManager = new LiveFeedSubscriptionManager() // not used right now

        // The feed manager -- each feed is a collection of append-only logs
        const localFeedManager = this.p.externalInterface.createLocalFeedManager()
        this.#feedManager = new FeedManager(this, localFeedManager)

        this.#remoteNodeManager = new RemoteNodeManager(this)

        let bootstrapAddresses = this.p.bootstrapAddresses

        const downloaderCreator = new DownloaderCreator(this, this.p.opts.getDefects)
        this.#downloadOptimizer = new DownloadOptimizer(downloaderCreator)
    }
    nodeId() {
        return this.#nodeId
    }
    channelNames() {
        return [...this.p.channelNames]
    }
    keyPair() {
        return this.#keyPair
    }
    remoteNodeManager() {
        return this.#remoteNodeManager
    }
    bootstrapAddresses() {
        return [...this.p.bootstrapAddresses]
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
    liveFeedSubscriptionManager() {
        /* istanbul ignore next */
        return this.#liveFeedSubscriptionManager // not used right now
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
    findFile(args: { fileKey: FileKey, timeoutMsec: DurationMsec, fromChannel: ChannelName | null }): {
        onFound: (callback: (result: FindFileResult) => void) => void,
        onFinished: (callback: () => void) => void,
        cancel: () => void
    } {
        const requestData: CheckForFileRequestData = {
            requestType: 'checkForFile',
            fileKey: args.fileKey
        }
        const channelNames = args.fromChannel ? [args.fromChannel] : this.p.channelNames
        const { onResponse, onFinished, cancel } = this.#remoteNodeManager.sendRequestToNodesInChannels(requestData, { timeoutMsec: args.timeoutMsec, channelNames })
        const onFoundCallbacks: ((result: FindFileResult) => void)[] = []
        const onFinishedCallbacks: (() => void)[] = []
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
        return {
            onFound: (cb) => {
                onFoundCallbacks.push(cb)
            },
            onFinished: (cb) => {
                onFinishedCallbacks.push(cb)
            },
            cancel: () => {
                cancel()
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
    setProxyConnectionToClient(nodeId: NodeId, c: ProxyConnectionToClient) {
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
    setProxyConnectionToServer(nodeId: NodeId, c: ProxyConnectionToServer) {
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
    // getChannelInfo(channelName: ChannelName): ChannelInfo {
    //     const remoteNodesInChannel: RemoteNode[] = this.#remoteNodeManager.getRemoteNodesInChannel(channelName)
    //     const x: ChannelInfo = {
    //         nodes: remoteNodesInChannel.map(n => {
    //             return n.getChannelNodeInfo(channelName)
    //         }).filter(channelInfo => (channelInfo !== null))
    //         .map(channelInfo => {
    //             if (channelInfo === null) {
    //                 throw Error('Unexpected channelInfo === null should have been filtered out')
    //             }
    //             return channelInfo
    //         })
    //     }
    //     return x
    // }
    hostName() {
        if (this.p.hostName) return this.p.hostName
        if (this.p.externalInterface.isMock) {
            return hostName(this.nodeId().toString())
        }
        else {
            /* istanbul ignore next */
            return null
        }
    }
    httpAddress(): Address | null {
        const h = this.hostName()
        return (h !== null) && (this.p.httpListenPort !== null) ? { hostName: h, port: this.p.httpListenPort } : null
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
    getChannelNodeInfo(channelName: ChannelName): ChannelNodeInfo {
        const proxyHttpAddresses: Address[] = []
        this.#proxyConnectionsToServers.forEach((c, remoteNodeId) => {
            const remoteNode = this.#remoteNodeManager.getRemoteNode(remoteNodeId)
            if (remoteNode) {
                const httpAddress = remoteNode._getRemoteNodeHttpAddress()
                if (httpAddress) {
                    proxyHttpAddresses.push(httpAddress)
                }
            }
        })
        const body = {
            channelName,
            nodeId: this.#nodeId,
            httpAddress: this.httpAddress(),
            webSocketAddress: this.webSocketAddress(),
            publicUdpSocketAddress: this.#publicUdpSocketAddress,
            proxyHttpAddresses,
            timestamp: nowTimestamp()
        }
        return {
            body,
            signature: getSignature(body, this.#keyPair)
        }
    }
    async getRemoteLiveFeedSignedMessages(args: {
        nodeId: NodeId,
        feedId: FeedId,
        subfeedHash: SubfeedHash,
        position: SubfeedPosition,
        maxNumMessages: MessageCount,
        waitMsec: DurationMsec
    }): Promise<SignedSubfeedMessage[]> {
        const { nodeId, feedId, subfeedHash, position, maxNumMessages, waitMsec } = args
        const requestData: GetLiveFeedSignedMessagesRequestData = {
            requestType: 'getLiveFeedSignedMessages',
            feedId,
            subfeedHash,
            position,
            maxNumMessages,
            waitMsec
        }
        const responseData = await this.#remoteNodeManager.sendRequestToNode(nodeId, requestData, { timeoutMsec: addDurations(waitMsec, scaledDurationMsec(1000)), method: 'default' })
        if (!isGetLiveFeedSignedMessagesResponseData(responseData)) {
            /* istanbul ignore next */
            throw Error('Unexpected response type.')
        }
        if (!responseData.success) {
            /* istanbul ignore next */
            throw Error(`Error getting remote live feed signed messages: ${responseData.errorMessage}`)
        }
        const { signedMessages } = responseData
        if (signedMessages === null) {
            /* istanbul ignore next */
            throw Error('Unexpected: signedMessages is null.')
        }
        return signedMessages
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
            const { onResponse, onFinished, cancel } = this.#remoteNodeManager.sendRequestToNodesInChannels(requestData, { timeoutMsec, channelNames: this.p.channelNames })
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
        })
    }
    async handleNodeToNodeRequest(request: NodeToNodeRequest): Promise<NodeToNodeResponse> {
        const { requestId, fromNodeId, toNodeId, timestamp, requestData } = request.body
        if (!verifySignature(request.body, request.signature, nodeIdToPublicKey(fromNodeId))) {
            // think about banning the node here
            throw Error('Invalid signature in node-to-node request')
        }
        if (toNodeId !== this.#nodeId) {
            // redirect request to a different node
            const p = this.#proxyConnectionsToClients.get(toNodeId)
            if (!p) {
                throw Error('No proxy connection to node.')
            }
            return await p.sendRequest(request)
        }

        let responseData: NodeToNodeResponseData
        // if (isProbeRequestData(requestData)) {
        //     responseData = await handleProbeRequest(this, fromNodeId, requestData)
        // }
        if (isGetChannelInfoRequestData(requestData)) {
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
        else if (isSetLiveFeedSubscriptionsRequestData(requestData)) {
            /* istanbul ignore next */
            responseData = await handleSetLiveFeedSubscriptionsRequest(this, fromNodeId, requestData)
        }
        else if (isGetLiveFeedSignedMessagesRequestData(requestData)) {
            responseData = await handleGetLiveFeedSignedMessagesRequest(this, fromNodeId, requestData)
        }
        else if (isDownloadFileDataRequestData(requestData)) {
            responseData = await handleDownloadFileDataRequest(this, fromNodeId, requestData)
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
            console.warn(requestData)
            /* istanbul ignore next */
            throw Error('Unexpected error: unrecognized request data.')
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
    streamFileData(nodeId: NodeId, streamId: StreamId): DataStreamy {
        if (nodeId !== this.#nodeId) {
            // redirect to a different node
            const p = this.#proxyConnectionsToClients.get(nodeId)
            if (!p) {
                throw Error(`No proxy connection to node: ${nodeId.slice(0, 6)} <> ${this.#nodeId.slice(0, 6)}`)
            }
            return p.streamFileData(streamId)
        }

        const s = this.#downloadStreamManager.get(streamId)
        if (!s) {
            /* istanbul ignore next */
            throw Error(`Unable to find download info for stream: ${streamId}: (node: ${this.#nodeId.slice(0, 6)})`)
        }
        const { startByte, endByte } = s
        if (endByte === null) {
            /* istanbul ignore next */
            throw Error('Unexpected')
        }
        const ret = new DataStreamy();
        (async () => {
            if (ret.isComplete()) return
            const dataStream = await this.#kacheryStorageManager.getFileReadStream(s.fileKey)
            try {
                if (ret.isComplete()) return
                dataStream.onStarted(size => { ret.producer().start(size) })
                ret.producer().onCancelled(() => {
                    dataStream.cancel()
                })
                dataStream.onData(b => { ret.producer().data(b) })
                dataStream.onFinished(() => { ret.producer().end() })
                dataStream.onError(err => { ret.producer().error(err) })
            }
            catch (err) {
                ret.producer().error(err)
            }
        })()
        return ret
    }
    receiveFallbackUdpPacket(fromNodeId: NodeId, packetId: PacketId, packet: Buffer): void {
        if (!this.#publicUdpSocketServer) {
            /* istanbul ignore next */
            throw Error('Cannot receive fallback udp packet. No public udp socket server set.')
        }
        this.#publicUdpSocketServer.receiveFallbackUdpPacket(fromNodeId, packetId, packet)
    }
}

class DownloadStreamManager {
    #downloadStreamInfos = new GarbageMap<StreamId, DownloadFileDataRequestData>(scaledDurationMsec(30 * 60 * 1000))
    set(streamId: StreamId, info: DownloadFileDataRequestData) {
        this.#downloadStreamInfos.set(streamId, info)
    }
    get(streamId: StreamId): DownloadFileDataRequestData | null {
        return this.#downloadStreamInfos.get(streamId) || null
    }
}

const _loadKeypair = (configDir: LocalFilePath): KeyPair => {
    if (!fs.existsSync(configDir.toString())) {
        throw Error(`Config directory does not exist: ${configDir}`)
    }
    const publicKeyPath = `${configDir.toString()}/public.pem`
    const privateKeyPath = `${configDir.toString()}/private.pem`
    if (fs.existsSync(publicKeyPath)) {
        if (!fs.existsSync(privateKeyPath)) {
            throw Error(`Public key file exists, but secret key file does not.`)
        }
    }
    else {
        const { publicKey, privateKey } = createKeyPair()
        fs.writeFileSync(publicKeyPath, publicKey.toString(), { encoding: 'utf-8' })
        fs.writeFileSync(privateKeyPath, privateKey.toString(), { encoding: 'utf-8' })
        fs.chmodSync(privateKeyPath, fs.constants.S_IRUSR | fs.constants.S_IWUSR)
    }

    const keyPair = {
        publicKey: fs.readFileSync(publicKeyPath, { encoding: 'utf-8' }),
        privateKey: fs.readFileSync(privateKeyPath, { encoding: 'utf-8' }),
    }
    if (!isKeyPair(keyPair)) {
        throw Error('Invalid keyPair')
    }
    testKeyPair(keyPair)
    return keyPair
}

const testKeyPair = (keyPair: KeyPair) => {
    const signature = getSignature({ test: 1 }, keyPair)
    if (!verifySignature({ test: 1 } as JSONObject, signature, keyPair.publicKey)) {
        throw new Error('Problem testing public/private keys. Error verifying signature.')
    }
    if (hexToPublicKey(publicKeyToHex(keyPair.publicKey)) !== keyPair.publicKey) {
        console.warn(hexToPublicKey(publicKeyToHex(keyPair.publicKey)))
        console.warn(keyPair.publicKey)
        throw new Error('Problem testing public/private keys. Error converting public key to/from hex.')
    }
    if (hexToPrivateKey(privateKeyToHex(keyPair.privateKey)) !== keyPair.privateKey) {
        throw new Error('Problem testing public/private keys. Error converting private key to/from hex.')
    }
}

export const readJsonFile = async (path: string) => {
    const txt = await fs.promises.readFile(path, 'utf-8');
    return JSON.parse(txt);
}

export default KacheryP2PNode