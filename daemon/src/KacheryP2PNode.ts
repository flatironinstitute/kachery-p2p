import { getSignature, publicKeyToHex, verifySignature } from './common/crypto_util'
import DataStreamy, { DataStreamyProgress } from './common/DataStreamy'
import GarbageMap from './common/GarbageMap'
import { sha1MatchesFileKey } from './common/util'
import DownloaderCreator from './downloadOptimizer/DownloaderCreator'
import DownloadOptimizer from './downloadOptimizer/DownloadOptimizer'
import DownloadOptimizerFile from './downloadOptimizer/DownloadOptimizerJob'
import ExternalInterface, { KacheryStorageManagerInterface } from './external/ExternalInterface'
import FeedManager from './feeds/FeedManager'
import { LiveFeedSubscriptionManager } from './feeds/LiveFeedSubscriptionManager'
import { Address, byteCount, ByteCount, byteCountToNumber, ChannelInfo, ChannelName, ChannelNodeInfo, durationMsec, DurationMsec, durationMsecToNumber, errorMessage, FeedId, FileKey, FindFileResult, FindLiveFeedResult, HostName, isAddress, isArrayOf, isByteCount, isSha1Hash, KeyPair, NodeId, nodeIdToPublicKey, nowTimestamp, Port, publicKeyHexToNodeId, Sha1Hash, SignedSubfeedMessage, SubfeedHash, SubmittedSubfeedMessage, UrlPath, _validateObject } from './interfaces/core'
import { AnnounceRequestData, AnnounceResponseData, CheckForFileRequestData, CheckForFileResponseData, CheckForLiveFeedRequestData, CheckForLiveFeedResponseData, createStreamId, DownloadFileDataRequestData, DownloadFileDataResponseData, GetChannelInfoRequestData, GetChannelInfoResponseData, GetLiveFeedSignedMessagesRequestData, GetLiveFeedSignedMessagesResponseData, isAnnounceRequestData, isCheckForFileRequestData, isCheckForFileResponseData, isCheckForLiveFeedRequestData, isCheckForLiveFeedResponseData, isDownloadFileDataRequestData, isGetChannelInfoRequestData, isGetLiveFeedSignedMessagesRequestData, isGetLiveFeedSignedMessagesResponseData, isProbeRequestData, isSetLiveFeedSubscriptionsRequestData, isSubmitMessageToLiveFeedResponseData, NodeToNodeRequest, NodeToNodeResponse, NodeToNodeResponseData, ProbeRequestData, ProbeResponseData, SetLiveFeedSubscriptionsRequestData, SetLiveFeedSubscriptionsResponseData, StreamId, SubmitMessageToLiveFeedRequestData } from './interfaces/NodeToNodeRequest'
import { daemonVersion, protocolVersion } from './protocolVersion'
import { ProxyConnectionToClient } from './proxyConnections/ProxyConnectionToClient'
import { ProxyConnectionToServer } from './proxyConnections/ProxyConnectionToServer'
import RemoteNode from './RemoteNode'
import RemoteNodeManager from './RemoteNodeManager'
import { ApiProbeResponse } from './services/PublicApiServer'
import PublicUdpSocketServer from './services/PublicUdpSocketServer'

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
        keyPair: KeyPair,
        verbose: number,
        hostName: HostName | null,
        httpListenPort: Port | null,
        udpListenPort: Port | null,
        webSocketListenPort: Port | null,
        label: string,
        bootstrapAddresses: Address[] | null,
        channelNames: ChannelName[],
        externalInterface: ExternalInterface,
        opts: {
            noBootstrap: boolean,
            isBootstrapNode: boolean,
            mock: boolean,
            multicastUdpAddress: string | null
        }
    }) {
        this.#keyPair = p.keyPair // the keypair
        this.#nodeId = publicKeyHexToNodeId(publicKeyToHex(this.#keyPair.publicKey)) // get the node id from the public key
        this.#kacheryStorageManager = p.externalInterface.kacheryStorageManager
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
        return (this.p.opts.multicastUdpAddress !== null)
    }
    findFile(args: {fileKey: FileKey, timeoutMsec: DurationMsec, fromChannel: ChannelName | null}): {
        onFound: (callback: (result: FindFileResult) => void) => void,
        onFinished: (callback: () => void) => void,
        cancel: () => void
    } {
        const requestData: CheckForFileRequestData = {
            requestType: 'checkForFile',
            fileKey: args.fileKey
        }
        const channelNames = args.fromChannel ? [args.fromChannel] : this.p.channelNames
        const {onResponse, onFinished, cancel} = this.#remoteNodeManager.sendRequestToNodesInChannels(requestData, {timeoutMsec: args.timeoutMsec, channelNames})
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
    async httpPostJson(address: Address, path: UrlPath, data: Object, opts: {timeoutMsec: DurationMsec}) {
        return await this.p.externalInterface.httpPostJsonFunction(address, path, data, opts)
    }
    async httpGetDownload(address: Address, path: UrlPath) {
        return await this.p.externalInterface.httpGetDownloadFunction(address, path)
    }
    dgramCreateSocket(args: {type: 'udp4', reuseAddr: boolean}) {
        return this.p.externalInterface.dgramCreateSocketFunction({type: args.type, reuseAddr: args.reuseAddr, nodeId: this.nodeId()})
    }
    createWebSocket(url: string, opts: {timeoutMsec: DurationMsec}) {
        return this.p.externalInterface.createWebSocketFunction(url, opts)
    }
    createWebSocketServer(port: Port) {
        return this.p.externalInterface.createWebSocketServerFunction(port, this.nodeId())
    }
    async _loadFileAsync(args: {fileKey: FileKey, opts: {fromNode: NodeId | null, fromChannel: ChannelName | null}}): Promise<{found: boolean, size: ByteCount}> {
        const r = await this.#kacheryStorageManager.findFile(args.fileKey)
        if (r.found) {
            return r
        }
        return new Promise<{found: boolean, size: ByteCount}>((resolve, reject) => {
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
    loadFile(args: {fileKey: FileKey, opts: {fromNode: NodeId | null, fromChannel: ChannelName | null}}): DataStreamy {
        const { fileKey, opts } = args
        const { fromNode, fromChannel } = opts
        const inProgressFiles: DownloadOptimizerFile[] = []
        const ret = new DataStreamy()
        ret.onComplete(() => {
            inProgressFiles.forEach(f => {
                f.decrementNumPointers()
            })
        });
        (async () => {
            try {
                if (fileKey.manifestSha1) {
                    const manifestFileKey = {sha1: fileKey.manifestSha1}
                    const manifestR = await this._loadFileAsync({fileKey: manifestFileKey, opts: {fromNode, fromChannel}})
                    if (!manifestR.found) {
                        throw Error('Unexpected... loadFileAsync should have thrown an error if not found')
                    }
                    const manifestDataStream = await this.p.externalInterface.kacheryStorageManager.getFileReadStream(fileKey)
                    const manifestBuf = (await manifestDataStream.allData()).toString()
                    const manifest = JSON.stringify(manifestBuf)
                    if (!isFileManifest(manifest)) {
                        throw new Error('Invalid manifest file')
                    }
                    if (!sha1MatchesFileKey({sha1: manifest.sha1, fileKey})) {
                        throw new Error(`Manifest sha1 does not match file key: ${manifest.sha1}`)
                    }
                    ret._start(manifest.size)
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
                            ret._error(err)
                        })
                        f.onProgress((progress: DataStreamyProgress) => {
                            _updateProgressForManifestLoad()
                        })
                        f.onFinished(() => {
                            numComplete ++
                            if (numComplete === manifest.chunks.length) {
                                _concatenateChunks().then(() => {
                                    ret._end()
                                }).catch((err: Error) => {
                                    ret._error(err)
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
                        ret._reportBytesLoaded(byteCount(bytesLoaded))
                    }
                    const _concatenateChunks = async () => {
                        // todo
                        // const chunkPaths: LocalFilePath[] = []
                        // for (let chunk of manifest.chunks) {
                        //     const r = await this.#kacheryStorageManager.findFile({sha1: chunk.sha1}, false)
                        //     if (!r.found) {
                        //         throw Error('Unexpected. Unable to find chunk in kachery storage after loading')
                        //     }
                        //     if (!r.dataStream) {
                        //         throw Error('Unexpected')
                        //     }
                        //     chunkPaths.push(r.localPath)
                        // }
                        // const {sha1, path: concatPath} = await concatenateFilesIntoTemporaryFile(chunkPaths)
                        // if (sha1 !== manifest.sha1) {
                        //     fs.unlinkSync(concatPath.toString())
                        //     throw Error('Unexpected SHA-1 of concatenated file.')
                        // }
                        // moveFileIntoKacheryStorage({path: concatPath, sha1: manifest.sha1})
                        // ret._end()
                    }
                }
                else {
                    let fileSize = fileKey.chunkOf ? byteCount(byteCountToNumber(fileKey.chunkOf.endByte) - byteCountToNumber(fileKey.chunkOf.startByte)) : null
                    const f = this.#downloadOptimizer.addFile(fileKey, fileSize)
                    f.incrementNumPointers()
                    inProgressFiles.push(f)
                    f.onError(err => {
                        ret._error(err)
                    })
                    f.onProgress((progress: DataStreamyProgress) => {
                        ret._reportBytesLoaded(progress.bytesLoaded)
                    })
                    f.onFinished(() => {
                        ret._end()
                    })
                    if (opts.fromNode) {
                        this.#downloadOptimizer.setProviderNodeForFile({fileKey, nodeId: opts.fromNode})
                    }
                    else {
                        const ff = this.findFile({fileKey, timeoutMsec: durationMsec(3000), fromChannel: opts.fromChannel})
                        let atLeastOneProviderFound = false
                        ff.onFound(result => {
                            this.#downloadOptimizer.setProviderNodeForFile({fileKey, nodeId: result.nodeId})
                            atLeastOneProviderFound = true
                        })
                        ff.onFinished(() => {
                            if (!atLeastOneProviderFound) {
                                ret._error(Error('File not found'))
                            }
                        })
                    }
                }
            }
            catch(err) {
                ret._error(err)
            }
        })()
        // todo: handle ret.onCancel ??
        return ret
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
    streamFileData(nodeId: NodeId, streamId: StreamId): DataStreamy {
        if (nodeId !== this.#nodeId) {
            // redirect to a different node
            const p = this.#proxyConnectionsToClients.get(nodeId)
            if (!p) {
                throw Error(`No proxy connection to node: ${nodeId.slice(0, 6)} <> ${this.#nodeId.slice(0, 6)}`)
            }
            return p.streamFileData(streamId)
        }

        const s = this.#downloadStreamInfos.get(streamId)
        if (!s) {
            throw Error(`Unable to find download info for stream: ${streamId}: (node: ${this.#nodeId.slice(0, 6)})`)
        }
        const {startByte, endByte} = s
        if (endByte === null) {
            throw Error('Unexpected')
        }
        const ret = new DataStreamy();
        (async () => {
            if (ret.isComplete()) return
            const dataStream = await this.#kacheryStorageManager.getFileReadStream(s.fileKey)
            try {
                if (ret.isComplete()) return
                dataStream.onStarted(size => {ret._start(size)})
                ret._onCancel(() => {
                    dataStream.cancel()
                })
                dataStream.onData(b => {ret._data(b)})
                dataStream.onFinished(() => {ret._end()})
                dataStream.onError(err => {ret._error(err)})
            }
            catch(err) {
                ret._error(err)
            }
        })()
        return ret
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
        const {found, size} = await this.#kacheryStorageManager.findFile(fileKey)
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
        let { fileKey, startByte, endByte } = requestData
        if ((byteCountToNumber(startByte) < 0) || ((endByte !== null) && (byteCountToNumber(startByte) >= byteCountToNumber(endByte)))) {
            return {
                requestType: 'downloadFileData',
                fileKey,
                startByte,
                endByte: endByte === null ? byteCount(0): endByte,
                success: false,
                streamId: null,
                errorMessage: errorMessage('Invalid start/end bytes')
            }
        }
        const {found, size} = await this.#kacheryStorageManager.findFile(fileKey)
        if (!found) {
            return {
                requestType: 'downloadFileData',
                fileKey,
                startByte,
                endByte: endByte === null ? byteCount(0): endByte,
                success: false,
                streamId: null,
                errorMessage: errorMessage('Unable to find file')
            }
        }
        if (size === null) {
            throw Error('Unexpected')
        }
        if (endByte === null) {
            endByte = size
        }
        if (endByte > size) {
            return {
                requestType: 'downloadFileData',
                fileKey,
                startByte,
                endByte: endByte === null ? byteCount(0): endByte,
                success: false,
                streamId: null,
                errorMessage: errorMessage('Start/end bytes out of range')
            }
        }
        const streamId = createStreamId()
        this.#downloadStreamInfos.set(streamId, {
            ...requestData,
            endByte
        })
        return {
            requestType: 'downloadFileData',
            fileKey,
            startByte,
            endByte,
            success: true,
            streamId,
            errorMessage: null
        }
    }
}

function str(x: any): string {return x as string}

export default KacheryP2PNode