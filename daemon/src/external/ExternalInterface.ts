import DataStreamy from "../common/DataStreamy"
import { Address, ByteCount, DurationMsec, FileKey, JSONObject, NodeId, Port, Sha1Hash, UrlPath } from "../interfaces/core"

export type HttpPostJsonFunction = ((address: Address, path: UrlPath, data: Object, opts: {timeoutMsec: DurationMsec}) => Promise<JSONObject>)
export type HttpGetDownloadFunction = ((address: Address, path: UrlPath) => Promise<DataStreamy>)

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

export type DgramCreateSocketFunction = (args: {type: 'udp4', reuseAddr: boolean, nodeId: NodeId}) => DgramSocket

export interface WebSocketInterface {
    onOpen: (callback: () => void) => void
    onClose: (callback: (code: number, reason: string) => void) => void
    onError: (callback: (err: Error | null) => void) => void
    onMessage: (callback: (buf: Buffer) => void) => void
    close: () => void
    send: (buf: Buffer) => void
}

export interface WebSocketServerInterface {
    onListening: (callback: () => void) => void
    onConnection: (callback: (ws: WebSocketInterface) => void) => void
    close: () => void
}

export type CreateWebSocketServerFunction = (port: Port, nodeId: NodeId) => WebSocketServerInterface

export type CreateWebSocketFunction = (url: string, opts: {timeoutMsec: DurationMsec}) => WebSocketInterface

export interface KacheryStorageManagerInterface {
    findFile: (fileKey: FileKey) => Promise<{found: boolean, size: ByteCount}>
    getFileReadStream: (fileKey: FileKey) => Promise<DataStreamy>
    storeFile: (sha1: Sha1Hash, data: Buffer) => Promise<void>
    concatenateChunks: (sha1: Sha1Hash, chunkSha1s: Sha1Hash[]) => Promise<void>
}

export type CreateKacheryStorageManagerFunction = () => KacheryStorageManagerInterface

export interface HttpServerInterface {
    listen: (port: number) => void
    close: () => void
}

export interface ExpressInterface {
    
}

export type StartHttpServerFunction = (app: ExpressInterface, port: Port) => HttpServerInterface

export default interface ExternalInterface {
    httpPostJson: HttpPostJsonFunction,
    httpGetDownload: HttpGetDownloadFunction,
    dgramCreateSocket: DgramCreateSocketFunction,
    createWebSocketServer: CreateWebSocketServerFunction,
    createWebSocket: CreateWebSocketFunction,
    createKacheryStorageManager: CreateKacheryStorageManagerFunction,
    startHttpServer: StartHttpServerFunction
}