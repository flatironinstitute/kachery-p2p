import fs from 'fs'
import { createKeyPair, getSignature, hexToPrivateKey, hexToPublicKey, privateKeyToHex, publicKeyToHex, verifySignature } from './common/crypto_util'
import GarbageMap from './common/GarbageMap'
import { UrlPath } from './common/httpPostJson'
import { readJsonFile, sha1MatchesFileKey } from './common/util'
import DownloaderCreator from './downloadOptimizer/DownloaderCreator'
import DownloadOptimizer from './downloadOptimizer/DownloadOptimizer'
import DownloadOptimizerFile from './downloadOptimizer/DownloadOptimizerJob'
import FeedManager from './feeds/FeedManager'
import { LiveFeedSubscriptionManager } from './feeds/LiveFeedSubscriptionManager'
import { Address, ChannelInfo, ChannelName, ChannelNodeInfo, errorMessage, FeedId, FileKey, FindFileResult, FindLiveFeedResult, HostName, isAddress, isArrayOf, isKeyPair, isSha1Hash, JSONObject, KeyPair, NodeId, nodeIdToPublicKey, nowTimestamp, Port, publicKeyHexToNodeId, Sha1Hash, SignedSubfeedMessage, SubfeedHash, SubmittedSubfeedMessage, _validateObject } from './interfaces/core'
import { AnnounceRequestData, AnnounceResponseData, CheckForFileRequestData, CheckForFileResponseData, CheckForLiveFeedRequestData, CheckForLiveFeedResponseData, createStreamId, DownloadFileDataRequestData, DownloadFileDataResponseData, GetChannelInfoRequestData, GetChannelInfoResponseData, GetLiveFeedSignedMessagesRequestData, GetLiveFeedSignedMessagesResponseData, isAnnounceRequestData, isCheckForFileRequestData, isCheckForFileResponseData, isCheckForLiveFeedRequestData, isCheckForLiveFeedResponseData, isDownloadFileDataRequestData, isGetChannelInfoRequestData, isGetLiveFeedSignedMessagesRequestData, isGetLiveFeedSignedMessagesResponseData, isProbeRequestData, isSetLiveFeedSubscriptionsRequestData, isSubmitMessageToLiveFeedResponseData, NodeToNodeRequest, NodeToNodeResponse, NodeToNodeResponseData, ProbeRequestData, ProbeResponseData, SetLiveFeedSubscriptionsRequestData, SetLiveFeedSubscriptionsResponseData, StreamId, SubmitMessageToLiveFeedRequestData } from './interfaces/NodeToNodeRequest'
import { concatenateFilesIntoTemporaryFile, moveFileIntoKacheryStorage } from './kacheryStorage/concatenateFiles'
import { FindFileReturnValue, LocalFilePath } from './kacheryStorage/KacheryStorageManager'
import { daemonVersion, protocolVersion } from './protocolVersion'
import { ProxyConnectionToClient } from './proxyConnections/ProxyConnectionToClient'
import { ProxyConnectionToServer } from './proxyConnections/ProxyConnectionToServer'
import RemoteNode from './RemoteNode'
import RemoteNodeManager from './RemoteNodeManager'
import { ApiProbeResponse } from './services/PublicApiServer'
import PublicUdpSocketServer from './services/PublicUdpSocketServer'
import { WebSocketInterface, WebSocketServerInterface } from './services/PublicWebSocketServer'
import { byteCount, ByteCount, byteCountToNumber, durationMsec, DurationMsec, durationMsecToNumber, isByteCount } from './udp/UdpCongestionManager'

export interface DgramRemoteInfo {
    address: string
    family: 'IPv4' | 'IPv6'
    port: number
    size: number
}

export type StreamFileDataOutput = {
    onStarted: (callback: (size: ByteCount) => void) => void,
    onData: (callback: (data: Buffer) => void) => void,
    onFinished: (callback: () => void) => void,
    onError: (callback: (err: Error) => void) => void,
    cancel: () => void
}

export interface LoadFileProgress {
    bytesLoaded: ByteCount,
    bytesTotal: ByteCount,
    nodeId: NodeId | null
}

interface FileManifestChunk {
    start: ByteCount,
    end: ByteCount,
    sha1: Sha1Hash
}
const isFileManifestChunk = (x: any): x is FileManifestChunk => {
    return _validateObject(x, {
        start: isByteCount,
        end: isByteCount,
        sha1: isSha1Hash
    })
}

interface FileManifest {
    size: ByteCount,
    sha1: Sha1Hash,
    chunks: FileManifestChunk[]
}
const isFileManifest = (x: any): x is FileManifest => {
    return _validateObject(x, {
        size: isByteCount,
        sha1: isSha1Hash,
        chunks: isArrayOf(isFileManifestChunk)
    })
}

export interface DgramSocket {
    bind: (port: number) => void,
    on: (eventName: 'listening' | 'message', callback: (() => void) | ((message: Buffer, rinfo: DgramRemoteInfo) => void)) => void,
    addMembership: (address: string) => void,
    send: (message: Buffer, offset: number, length: number, port: number, address: string, callback?: (err: Error | null, numBytesSent: number) => void) => void
    close: () => void
}

export type DgramCreateSocketFunction = (args: {type: 'udp4', reuseAddr: boolean, nodeId: NodeId}) => DgramSocket

export interface KacheryStorageManagerInterface {
    findFile: (fileKey: FileKey) => Promise<FindFileReturnValue>
}

export type CreateWebSocketServerFunction = (port: Port, nodeId: NodeId) => WebSocketServerInterface

export type CreateWebSocketFunction = (url: string, opts: {timeoutMsec: DurationMsec}) => WebSocketInterface

class KacheryP2PNode {
    #keyPair: KeyPair
    #nodeId: NodeId
    #feedManager: FeedManager
    #remoteNodeManager: RemoteNodeManager
    #kacheryStorageManager: KacheryStorageManagerInterface
    #liveFeedSubscriptionManager: LiveFeedSubscriptionManager
    #proxyConnectionsToClients = new Map<NodeId, ProxyConnectionToClient>()
    #proxyConnectionsToServers = new Map<NodeId, ProxyConnectionToServer>()
    #bootstrapAddresses: Address[] // not same as argument to constructor
    #downloadStreamInfos = new GarbageMap<StreamId, DownloadFileDataRequestData>(durationMsec(30 * 60 * 1000))
    #publicUdpSocketAddress: Address | null = null
    #publicUdpSocketServer: PublicUdpSocketServer | null = null
    #downloadOptimizer: DownloadOptimizer
    constructor(private p : {
        configDir: LocalFilePath,
        verbose: number,
        hostName: HostName | null,
        httpListenPort: Port | null,
        udpListenPort: Port | null,
        webSocketListenPort: Port | null,
        label: string,
        bootstrapAddresses: Address[] | null,
        channelNames: ChannelName[],
        httpPostJsonFunction: ((address: Address, path: UrlPath, data: Object, opts: {timeoutMsec: DurationMsec}) => Promise<JSONObject>),
        dgramCreateSocketFunction: DgramCreateSocketFunction,
        createWebSocketServerFunction: CreateWebSocketServerFunction,
        createWebSocketFunction: CreateWebSocketFunction,
        kacheryStorageManager: KacheryStorageManagerInterface,
        opts: {
            noBootstrap: boolean,
            isBootstrapNode: boolean,
            mock: boolean,
            useMulticastUdp: boolean
        }
    }) {
        const { publicKey, privateKey } = _loadKeypair(this.p.configDir) // The keypair for signing messages and the public key is used as the node id
        this.#keyPair = {publicKey, privateKey} // the keypair
        this.#nodeId = publicKeyHexToNodeId(publicKeyToHex(this.#keyPair.publicKey)) // get the node id from the public key
        this.#kacheryStorageManager = p.kacheryStorageManager
        this.#liveFeedSubscriptionManager = new LiveFeedSubscriptionManager()

        // The feed manager -- each feed is a collection of append-only logs
        this.#feedManager = new FeedManager(this)

        this.#remoteNodeManager = new RemoteNodeManager(this)

        let bootstrapAddresses = this.p.bootstrapAddresses
        if (!this.p.opts.noBootstrap) {
            if (bootstrapAddresses === null) {
                bootstrapAddresses = [
                        {hostName: '45.33.92.31', port: <Port><any>46002}, // kachery-p2p-spikeforest
                        {hostName: '45.33.92.33', port: <Port><any>46002} // kachery-p2p-flatiron1
                ].map(bpi => {
                    if (isAddress(bpi)) {
                        return bpi
                    }
                    else {
                        throw Error(`Not an address: ${bpi}`)
                    }
                }).filter(bpi => {
                    if ((bpi.hostName === 'localhost') || (bpi.hostName === this.p.hostName)) {
                        if (bpi.port === this.p.httpListenPort) {
                            return false
                        }
                    }
                    return true
                })
            }
        }
        this.#bootstrapAddresses = bootstrapAddresses || []

        const downloaderCreator = new DownloaderCreator(this)
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
        return [...this.#bootstrapAddresses]
    }
    isBootstrapNode() {
        return this.p.opts.isBootstrapNode
    }
    useMulticastUdp() {
        return this.p.opts.useMulticastUdp
    }
    findFile(args: {fileKey: FileKey, timeoutMsec: DurationMsec}): {
        onFound: (callback: (result: FindFileResult) => void) => void,
        onFinished: (callback: () => void) => void,
        cancel: () => void
    } {
        const requestData: CheckForFileRequestData = {
            requestType: 'checkForFile',
            fileKey: args.fileKey
        }
        const {onResponse, onFinished, cancel} = this.#remoteNodeManager.sendRequestToNodesInChannels(requestData, {timeoutMsec: args.timeoutMsec, channelNames: this.p.channelNames})
        const onFoundCallbacks: ((result: FindFileResult) => void)[] = []
        const onFinishedCallbacks: (() => void)[] = []
        onResponse((nodeId: NodeId, responseData: NodeToNodeResponseData) => {
            if (!isCheckForFileResponseData(responseData)) {
                console.warn(responseData)
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
    httpPostJsonFunction() {
        return this.p.httpPostJsonFunction
    }
    dgramCreateSocket(args: {type: 'udp4', reuseAddr: boolean}) {
        return this.p.dgramCreateSocketFunction({type: args.type, reuseAddr: args.reuseAddr, nodeId: this.nodeId()})
    }
    createWebSocket(url: string, opts: {timeoutMsec: DurationMsec}) {
        return this.p.createWebSocketFunction(url, opts)
    }
    createWebSocketServer(port: Port) {
        return this.p.createWebSocketServerFunction(port, this.nodeId())
    }
    async _loadFileAsync(args: {fileKey: FileKey, opts: {fromNode: NodeId | undefined, fromChannel: ChannelName | undefined}}): Promise<FindFileReturnValue> {
        const r = await this.#kacheryStorageManager.findFile(args.fileKey)
        if (r.found) {
            return r
        }
        return new Promise<FindFileReturnValue>((resolve, reject) => {
            const {onFinished, onProgress, onError, cancel} = this.loadFile({fileKey: args.fileKey, opts: args.opts})
            onError(err => {
                reject(err)
            })
            onFinished(() => {
                (async () => {
                    const r = await this.#kacheryStorageManager.findFile(args.fileKey)
                    if (r.found) {
                        resolve(r)
                    }
                    else {
                        reject(Error('Unexpected - unable to findFile after loadFile reported finished.'))
                    }
                })()
            })
        })
    }
    loadFile(args: {fileKey: FileKey, opts: {fromNode: NodeId | undefined, fromChannel: ChannelName | undefined}}): {
        onFinished: (callback: () => void) => void,
        onProgress: (callback: (progress: LoadFileProgress) => void) => void,
        onError: (callback: (err: Error) => void) => void,
        cancel: () => void
    } {
        const { fileKey, opts } = args
        const { fromNode, fromChannel } = opts
        const inProgressFiles: DownloadOptimizerFile[] = []
        const _onFinishedCallbacks: (() => void)[] = []
        const _onErrorCallbacks: ((err: Error) => void)[] = []
        const _onProgressCallbacks: ((progress: LoadFileProgress) => void)[] = []
        let complete = false
        const _handleError = (err: Error) => {
            if (complete) return
            complete = true
            inProgressFiles.forEach(f => {
                f.decrementNumPointers()
            })
            _onErrorCallbacks.forEach(cb => {cb(err)})
        }
        const _handleFinished = () => {
            if (complete) return
            complete = true
            _onFinishedCallbacks.forEach(cb => {cb()})
        }
        const _handleProgress = (progress: LoadFileProgress) => {
            if (complete) return
            _onProgressCallbacks.forEach(cb => {cb(progress)})
        }
        const _cancel = () => {
            _handleError(Error('Cancelled'))
        }
        (async () => {
            try {
                if (fileKey.manifestSha1) {
                    const manifestFileKey = {sha1: fileKey.manifestSha1}
                    const manifestR = await this._loadFileAsync({fileKey: manifestFileKey, opts: {fromNode, fromChannel}})
                    if (!manifestR.found) {
                        throw Error('Unexpected... loadFileAsync should have thrown an error if not found')
                    }
                    const { localPath: manifestPath } = manifestR
                    if (manifestPath === null) {
                        throw Error('unexpected')
                    }
                    const manifest = await readJsonFile(manifestPath.toString())
                    if (!isFileManifest(manifest)) {
                        throw new Error('Invalid manifest file')
                    }
                    if (!sha1MatchesFileKey({sha1: manifest.sha1, fileKey})) {
                        throw new Error(`Manifest sha1 does not match file key: ${manifest.sha1}`)
                    }
                    let numComplete = 0
                    manifest.chunks.forEach((chunk: FileManifestChunk) => {
                        const chunkFileKey: FileKey = {
                            sha1: chunk.sha1,
                            chunkOf: {
                                fileKey: {
                                    sha1: manifest.sha1
                                },
                                startByte: chunk.start,
                                endByte: chunk.end
                            }
                        }
                        const f = this.#downloadOptimizer.addFile(chunkFileKey, byteCount(byteCountToNumber(chunk.end) - byteCountToNumber(chunk.start)))
                        f.incrementNumPointers()
                        inProgressFiles.push(f)
                        f.onError(err => {
                            _handleError(err)
                        })
                        f.onProgress((progress: LoadFileProgress) => {
                            _updateProgressForManifestLoad()
                        })
                        f.onFinished(() => {
                            numComplete ++
                            if (numComplete === manifest.chunks.length) {
                                _concatenateChunks().then(() => {
                                    _handleFinished()
                                }).catch((err: Error) => {
                                    _handleError(err)
                                })
                            }
                        })
                    })
                    const _updateProgressForManifestLoad = () => {
                        // todo: make this more efficient - don't need to loop through all in-progress files every time
                        let bytesLoaded = 0
                        inProgressFiles.forEach(f => {
                            bytesLoaded += byteCountToNumber(f.bytesLoaded())
                        })
                        _handleProgress({
                            bytesLoaded: byteCount(bytesLoaded),
                            bytesTotal: manifest.size,
                            nodeId: fromNode || null
                        })
                    }
                    const _concatenateChunks = async () => {
                        const chunkPaths: LocalFilePath[] = []
                        for (let chunk of manifest.chunks) {
                            const r = await this.#kacheryStorageManager.findFile({sha1: chunk.sha1})
                            if (!r.found) {
                                throw Error('Unexpected. Unable to find chunk in kachery storage after loading')
                            }
                            if (!r.localPath) {
                                throw Error('Unexpected')
                            }
                            chunkPaths.push(r.localPath)
                        }
                        const {sha1, path: concatPath} = await concatenateFilesIntoTemporaryFile(chunkPaths)
                        if (sha1 !== manifest.sha1) {
                            fs.unlinkSync(concatPath.toString())
                            throw Error('Unexpected SHA-1 of concatenated file.')
                        }
                        moveFileIntoKacheryStorage({path: concatPath, sha1: manifest.sha1})
                        _handleFinished()
                    }
                }
                else {
                    let fileSize = fileKey.chunkOf ? byteCount(byteCountToNumber(fileKey.chunkOf.endByte) - byteCountToNumber(fileKey.chunkOf.startByte)) : null
                    const f = this.#downloadOptimizer.addFile(fileKey, fileSize)
                    f.incrementNumPointers()
                    inProgressFiles.push(f)
                    f.onError(err => {
                        _handleError(err)
                    })
                    f.onProgress((progress: LoadFileProgress) => {
                        _handleProgress(progress)
                    })
                    f.onFinished(() => {
                        _handleFinished()
                    })
                }
            }
            catch(err) {
                _handleError(err)
            }
        })()
        return {
            onFinished: (callback: () => void) => {_onFinishedCallbacks.push(callback)},
            onProgress: (callback: (progress: LoadFileProgress) => void) => {_onProgressCallbacks.push(callback)},
            onError: (callback: (err: Error) => void) => {_onErrorCallbacks.push(callback)},
            cancel: _cancel
        }
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
    getProxyConnectionToClient(nodeId: NodeId) {
        return this.#proxyConnectionsToClients.get(nodeId) || null
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
    }
    getProxyConnectionToServer(nodeId: NodeId) {
        return this.#proxyConnectionsToServers.get(nodeId) || null
    }
    getChannelInfo(channelName: ChannelName): ChannelInfo {
        const remoteNodesInChannel: RemoteNode[] = this.#remoteNodeManager.getRemoteNodesInChannel(channelName)
        const x: ChannelInfo = {
            nodes: remoteNodesInChannel.map(n => {
                return n.getChannelNodeInfo(channelName)
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
    hostName() {
        if (this.p.hostName) return this.p.hostName
        if (this.p.opts.mock) {
            return this.nodeId() as any as HostName
        }
        else {
            return null
        }
    }
    httpAddress(): Address | null {
        const h = this.hostName()
        return (h !== null) && (this.p.httpListenPort !== null) ? {hostName: h, port: this.p.httpListenPort} : null
    }
    webSocketAddress(): Address | null {
        const h = this.hostName()
        return (h !== null) && (this.p.webSocketListenPort !== null) ? {hostName: h, port: this.p.webSocketListenPort} : null
    }
    udpListenPort() {
        return this.p.udpListenPort
    }
    publicUdpSocketAddress(): Address | null {
        if (this.#publicUdpSocketAddress !== null) {
            return this.#publicUdpSocketAddress
        }
        else {
            const h = this.hostName()
            if ((h !== null) && (this.p.udpListenPort !== null)) {
                return {
                    hostName: h,
                    port: this.p.udpListenPort
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
        position: number,
        maxNumMessages: number,
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
        const responseData = await this.#remoteNodeManager.sendRequestToNode(nodeId, requestData, {timeoutMsec: durationMsec(durationMsecToNumber(waitMsec) + 1000), method: 'default'})
        if (!isGetLiveFeedSignedMessagesResponseData(responseData)) {
            throw Error('Unexpected response type.')
        }
        if (!responseData.success) {
            throw Error(`Error getting remote live feed signed messages: ${responseData.errorMessage}`)
        }
        const { signedMessages } = responseData
        if (signedMessages === null) {
            throw Error('Unexpected: signedMessages is null.')
        }
        return signedMessages
    }
    async submitMessageToRemoteLiveFeed({nodeId, feedId, subfeedHash, message, timeoutMsec}: {
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
        const responseData = await this.#remoteNodeManager.sendRequestToNode(nodeId, requestData, {timeoutMsec: timeoutMsec, method: 'default'})
        if (!isSubmitMessageToLiveFeedResponseData(responseData)) {
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
        const {feedId, timeoutMsec} = args
        return new Promise<FindLiveFeedResult | null>((resolve, reject) => {
            const requestData: CheckForLiveFeedRequestData = {
                requestType: 'checkForLiveFeed',
                feedId
            }
            const {onResponse, onFinished, cancel} = this.#remoteNodeManager.sendRequestToNodesInChannels(requestData, {timeoutMsec, channelNames: this.p.channelNames})
            let found = false
            onResponse((nodeId, responseData) => {
                if (found) return
                if (!isCheckForLiveFeedResponseData(responseData)) {
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
            // todo: is this the right way to handle this situation?
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
        if (isProbeRequestData(requestData)) {
            responseData = await this._handleProbeRequest({fromNodeId, requestData})
        }
        else if (isGetChannelInfoRequestData(requestData)) {
            responseData = await this._handleGetChannelInfoRequest({fromNodeId, requestData})
        }
        else if (isAnnounceRequestData(requestData)) {
            responseData = await this._handleAnnounceRequest({fromNodeId, requestData, localUdpAddress: null})
        }
        else if (isCheckForFileRequestData(requestData)) {
            responseData = await this._handleCheckForFileRequest({fromNodeId, requestData})
        }
        else if (isCheckForLiveFeedRequestData(requestData)) {
            responseData = await this._handleCheckForLiveFeedRequest({fromNodeId, requestData})
        }
        else if (isSetLiveFeedSubscriptionsRequestData(requestData)) {
            responseData = await this._handleSetLiveFeedSubscriptionsRequest({fromNodeId, requestData})
        }
        else if (isGetLiveFeedSignedMessagesRequestData(requestData)) {
            responseData = await this._handleGetLiveFeedSignedMessagesRequest({fromNodeId, requestData})
        }
        else if (isDownloadFileDataRequestData(requestData)) {
            responseData = await this._handleDownloadFileDataRequest({fromNodeId, requestData})
        }
        else {
            console.warn(requestData)
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
    streamFileData(nodeId: NodeId, streamId: StreamId): StreamFileDataOutput {
        if (nodeId !== this.#nodeId) {
            // redirect to a different node
            const p = this.#proxyConnectionsToClients.get(nodeId)
            if (!p) {
                throw Error('No proxy connection to node.')
            }
            return p.streamFileData(streamId)
        }
        const _onStartedCallbacks: ((size: ByteCount) => void)[] = []
        const _onDataCallbacks: ((data: Buffer) => void)[] = []
        const _onFinishedCallbacks: (() => void)[] = []
        const _onErrorCallbacks: ((err: Error) => void)[] = []
        const _onCancelCallbacks: (() => void)[] = []
        let complete = false
        let cancelled = false
        const _cancel = () => {
            if (cancelled) return
            cancelled = true
            _onCancelCallbacks.forEach(cb => {cb()})
            _handleError(Error('Cancelled'))
        }
        const _onCancel = (callback: () => void) => {_onCancelCallbacks.push(callback)}
        const _handleStarted = (size: ByteCount) => {
            if (complete) return
            _onStartedCallbacks.forEach(cb => {cb(size)})
        }
        const _handleError = (err: Error) => {
            if (complete) return
            complete = true
            this.#downloadStreamInfos.delete(streamId)
            _onErrorCallbacks.forEach(cb => {cb(err)})
        }
        const _handleFinished = () => {
            if (complete) return
            complete = true
            this.#downloadStreamInfos.delete(streamId)
            _onFinishedCallbacks.forEach(cb => {cb()})
        }
        const _handleData = (data: Buffer) => {
            if (complete) return
            _onDataCallbacks.forEach(cb => {cb(data)})
        }
        const s = this.#downloadStreamInfos.get(streamId)
        if (!s) {
            throw Error('Unable to find download info for stream.')
        }
        (async () => {
            if (complete) return
            const {found, size, localPath, byteOffset} = await this.#kacheryStorageManager.findFile(s.fileKey)
            if ((found) && (size !== null) && (localPath !== null) && (byteOffset !== null)) {
                try {
                    if (complete) return
                    const readStream = fs.createReadStream(localPath.toString(), {encoding: 'binary', start: Number(byteOffset) + Number(s.startByte), end: Number(byteOffset) + Number(s.endByte)})
                    _handleStarted(byteCount(byteCountToNumber(s.endByte) - byteCountToNumber(s.startByte)))
                    _onCancel(() => {
                        readStream.close()
                    })
                    readStream.on('data', (chunk: Buffer) => {
                        _handleData(chunk)
                    })
                    readStream.on('end', () => {
                        _handleFinished()
                    })
                    readStream.on('error', (err: Error) => {
                        _handleError(err)
                    })
                }
                catch(err) {
                    _handleError(err)
                }
            }
            else {
                _handleError(Error('file not found'))
            }
        })()
        return {
            onStarted: (callback: (size: ByteCount) => void) => {_onStartedCallbacks.push(callback)},
            onData: (callback: (data: Buffer) => void) => {_onDataCallbacks.push(callback)},
            onFinished: (callback: () => void) => {_onFinishedCallbacks.push(callback)},
            onError: (callback: (err: Error) => void) => {_onErrorCallbacks.push(callback)},
            cancel: _cancel
        }
    }
    async _handleProbeRequest({fromNodeId, requestData} : {fromNodeId: NodeId, requestData: ProbeRequestData}): Promise<ProbeResponseData> {
        const probeResponse: ApiProbeResponse = {
            success: true,
            protocolVersion: protocolVersion(),
            daemonVersion: daemonVersion(),
            nodeId: this.nodeId(),
            isBootstrapNode: this.isBootstrapNode(),
            webSocketAddress: this.webSocketAddress(),
            publicUdpSocketAddress: this.publicUdpSocketAddress()
        }
        return {
            requestType: 'probe',
            probeResponse
        }
    }
    async _handleGetChannelInfoRequest({fromNodeId, requestData} : {fromNodeId: NodeId, requestData: GetChannelInfoRequestData}): Promise<GetChannelInfoResponseData> {
        const { channelName } = requestData
        const channelInfo = await this.#remoteNodeManager.getChannelInfo(channelName)
        return {
            requestType: 'getChannelInfo',
            channelInfo
        }
    }
    async _handleAnnounceRequest({fromNodeId, requestData, localUdpAddress} : {fromNodeId: NodeId, requestData: AnnounceRequestData, localUdpAddress: Address | null}): Promise<AnnounceResponseData> {
        return await this.#remoteNodeManager.handleAnnounceRequest({fromNodeId, requestData, localUdpAddress})
    }
    async _handleCheckForFileRequest({fromNodeId, requestData} : {fromNodeId: NodeId, requestData: CheckForFileRequestData}): Promise<CheckForFileResponseData> {
        const { fileKey } = requestData
        const {found, size, localPath, byteOffset} = await this.#kacheryStorageManager.findFile(fileKey)
        return {
            requestType: 'checkForFile',
            found,
            size
        }
    }
    async _handleCheckForLiveFeedRequest({fromNodeId, requestData} : {fromNodeId: NodeId, requestData: CheckForLiveFeedRequestData}): Promise<CheckForLiveFeedResponseData> {
        const { feedId } = requestData
        const found = await this.#feedManager.hasWriteableFeed({feedId})
        return {
            requestType: 'checkForLiveFeed',
            found
        }
    }
    async _handleSetLiveFeedSubscriptionsRequest({fromNodeId, requestData} : {fromNodeId: NodeId, requestData: SetLiveFeedSubscriptionsRequestData}): Promise<SetLiveFeedSubscriptionsResponseData> {
        const { liveFeedSubscriptions } = requestData
        await this.#liveFeedSubscriptionManager.setSubscriptions({nodeId: fromNodeId, subscriptions: liveFeedSubscriptions})
        return {
            requestType: 'setLiveFeedSubscriptions',
            success: true
        }
    }
    async _handleGetLiveFeedSignedMessagesRequest({fromNodeId, requestData} : {fromNodeId: NodeId, requestData: GetLiveFeedSignedMessagesRequestData}): Promise<GetLiveFeedSignedMessagesResponseData> {
        const { feedId, subfeedHash, position, maxNumMessages, waitMsec } = requestData
        const hasLiveFeed = await this.#feedManager.hasWriteableFeed({feedId})
        if (!hasLiveFeed) {
            return {
                requestType: 'getLiveFeedSignedMessages',
                success: false,
                errorMessage: errorMessage('Live feed not found.'),
                signedMessages: null
            }
        }
        const signedMessages = await this.#feedManager.getSignedMessages({feedId, subfeedHash, position, maxNumMessages, waitMsec})
        return {
            requestType: 'getLiveFeedSignedMessages',
            success: true,
            errorMessage: null,
            signedMessages
        }
    }
    async _handleDownloadFileDataRequest({fromNodeId, requestData} : {fromNodeId: NodeId, requestData: DownloadFileDataRequestData}): Promise<DownloadFileDataResponseData> {
        const { fileKey, startByte, endByte } = requestData
        if ((byteCountToNumber(startByte) < 0) || ((endByte !== null) && (byteCountToNumber(startByte) >= byteCountToNumber(endByte)))) {
            return {
                requestType: 'downloadFileData',
                success: false,
                streamId: null,
                errorMessage: errorMessage('Invalid start/end bytes')
            }
        }
        const {found, size, localPath, byteOffset} = await this.#kacheryStorageManager.findFile(fileKey)
        if (!found) {
            return {
                requestType: 'downloadFileData',
                success: false,
                streamId: null,
                errorMessage: errorMessage('Unable to find file')
            }
        }
        if (size === null) {
            throw Error('Unexpected')
        }
        if (endByte > size) {
            return {
                requestType: 'downloadFileData',
                success: false,
                streamId: null,
                errorMessage: errorMessage('Start/end bytes out of range')
            }
        }
        const streamId = createStreamId()
        this.#downloadStreamInfos.set(streamId, requestData)
        return {
            requestType: 'downloadFileData',
            success: true,
            streamId,
            errorMessage: null
        }
    }
}

const _loadKeypair = (configDir: LocalFilePath): KeyPair => {
    let keyPair
    if (configDir.toString() === 'mock-config-dir') {
        keyPair = createKeyPair()
    }
    else {
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
            const {publicKey, privateKey} = createKeyPair()
            fs.writeFileSync(publicKeyPath, str(publicKey), {encoding: 'utf-8'})
            fs.writeFileSync(privateKeyPath, str(privateKey), {encoding: 'utf-8'})
            fs.chmodSync(privateKeyPath, fs.constants.S_IRUSR | fs.constants.S_IWUSR)
        }
        
        keyPair = {
            publicKey: fs.readFileSync(publicKeyPath, {encoding: 'utf-8'}),
            privateKey: fs.readFileSync(privateKeyPath, {encoding: 'utf-8'}),
        }
    }
    if (!isKeyPair(keyPair)) {
        throw Error('Invalid keyPair')
    }
    testKeyPair(keyPair)
    return keyPair
}

const testKeyPair = (keyPair: KeyPair) => {
    const signature = getSignature({test: 1}, keyPair)
    if (!verifySignature({test: 1} as JSONObject, signature, keyPair.publicKey)) {
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

function str(x: any): string {return x as string}

export default KacheryP2PNode