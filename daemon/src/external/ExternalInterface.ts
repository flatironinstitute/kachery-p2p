import DataStreamy from "../common/DataStreamy"
import { Address, ByteCount, DurationMsec, FeedId, FeedName, FileKey, JSONObject, LocalFilePath, NodeId, Port, PrivateKey, Sha1Hash, SignedSubfeedMessage, SubfeedAccessRules, SubfeedHash, UrlPath } from "../interfaces/core"
import MutableManager from "../mutables/MutableManager"
import NodeStats from "../NodeStats"

export type HttpPostJsonFunction = ((address: Address, path: UrlPath, data: Object, opts: {timeoutMsec: DurationMsec}) => Promise<JSONObject>)
export type HttpGetDownloadFunction = ((address: Address, path: UrlPath, stats: NodeStats, opts: {fromNodeId: NodeId | null}) => Promise<DataStreamy>)

export interface DgramSocket {
    bind: (port: number) => void,
    on: (eventName: 'listening' | 'message', callback: (() => void) | ((message: Buffer, rinfo: DgramRemoteInfo) => void)) => void,
    addMembership: (address: string) => void,
    send: (message: Buffer, offset: number, length: number, port: number, address: string, callback?: (err: Error | null, numBytesSent: number) => void) => void
    close: () => void
}

export interface DgramRemoteInfo {
    address: string
    family: 'IPv4' | 'IPv6'
    port: number
    size: number
}

export type DgramCreateSocketFunction = (args: {type: 'udp4', reuseAddr: boolean, nodeId: NodeId, firewalled: boolean}) => DgramSocket

export interface WebSocketInterface {
    onOpen: (callback: () => void) => void
    onClose: (callback: (code: number, reason: string) => void) => void
    onError: (callback: (err: Error | null) => void) => void
    onMessage: (callback: (buf: Buffer) => void) => void
    close: () => void
    send: (buf: Buffer) => void
}

export interface WebSocketServerInterface {
    onConnection: (callback: (ws: WebSocketInterface) => void) => void
    close: () => void
}

export type StartWebSocketServerFunction = (port: Port, nodeId: NodeId) => Promise<WebSocketServerInterface>

export type CreateWebSocketFunction = (url: string, opts: {timeoutMsec: DurationMsec}) => WebSocketInterface

export interface KacheryStorageManagerInterface {
    hasLocalFile: (fileKey: FileKey) => Promise<boolean>
    findFile: (fileKey: FileKey) => Promise<{found: boolean, size: ByteCount, localFilePath: LocalFilePath | null}>
    getFileReadStream: (fileKey: FileKey) => Promise<DataStreamy>
    storeFile: (sha1: Sha1Hash, data: Buffer) => Promise<void>
    storeLocalFile: (localFilePath: LocalFilePath) => Promise<{sha1: Sha1Hash, manifestSha1: Sha1Hash | null}>
    storeFileFromStream: (stream: DataStreamy, fileSize: ByteCount) => Promise<{sha1: Sha1Hash, manifestSha1: Sha1Hash | null}>
    concatenateChunksAndStoreResult: (sha1: Sha1Hash, chunkSha1s: Sha1Hash[]) => Promise<void>
    storageDir: () => LocalFilePath
}

export type CreateKacheryStorageManagerFunction = () => KacheryStorageManagerInterface

export interface LocalFeedManagerInterface {
    createFeed: (feedName: FeedName | null) => Promise<FeedId>
    deleteFeed: (feedId: FeedId) => Promise<void>
    getFeedId: (feedName: FeedName) => Promise<FeedId | null>
    hasWriteableFeed: (feedId: FeedId) => Promise<boolean>
    getPrivateKeyForFeed: (feedId: FeedId) => Promise<PrivateKey | null>
    feedExistsLocally: (feedId: FeedId) => Promise<boolean>
    getSignedSubfeedMessages: (feedId: FeedId, subfeedHash: SubfeedHash) => Promise<SignedSubfeedMessage[]>
    getSubfeedAccessRules: (feedId: FeedId, subfeedHash: SubfeedHash) => Promise<SubfeedAccessRules | null>
    appendSignedMessagesToSubfeed: (feedId: FeedId, subfeedHash: SubfeedHash, messages: SignedSubfeedMessage[]) => Promise<void> // synchronous???!!!
    setSubfeedAccessRules: (feedId: FeedId, subfeedHash: SubfeedHash, accessRules: SubfeedAccessRules) => Promise<void> // synchronous???!!!
}

export type CreateLocalFeedManagerFunction = (mutableManager: MutableManager) => LocalFeedManagerInterface

export interface HttpServerInterface {
    close: () => void
    on: (eventName: 'listening', callback: () => void) => void
}

export interface ExpressInterface {
    
}

export type StartHttpServerFunction = (app: ExpressInterface, port: Port) => Promise<HttpServerInterface>

export default interface ExternalInterface {
    httpPostJson: HttpPostJsonFunction,
    httpGetDownload: HttpGetDownloadFunction,
    dgramCreateSocket: DgramCreateSocketFunction,
    startWebSocketServer: StartWebSocketServerFunction,
    createWebSocket: CreateWebSocketFunction,
    createKacheryStorageManager: CreateKacheryStorageManagerFunction,
    createLocalFeedManager: CreateLocalFeedManagerFunction,
    startHttpServer: StartHttpServerFunction,
    isMock: boolean
}