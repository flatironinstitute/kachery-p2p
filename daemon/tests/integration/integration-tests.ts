import { expect } from 'chai';
import crypto from 'crypto';
import * as mocha from 'mocha'; // import types for mocha e.g. describe
import { createKeyPair } from '../../src/common/crypto_util';
import DataStreamy from '../../src/common/DataStreamy';
import { UrlPath } from '../../src/common/httpPostJson';
import { randomAlphaString, sleepMsec } from '../../src/common/util';
import { DgramCreateSocketFunction, DgramRemoteInfo, WebSocketInterface, WebSocketServerInterface } from '../../src/external/ExternalInterface';
import { Address, ChannelName, elapsedSince, FileKey, FindFileResult, HostName, isNodeId, JSONObject, NodeId, nowTimestamp, Port, Sha1Hash } from '../../src/interfaces/core';
import KacheryP2PNode from '../../src/KacheryP2PNode';
import DaemonApiServer, { ApiFindFileRequest } from '../../src/services/DaemonApiServer';
import PublicApiServer from '../../src/services/PublicApiServer';
import startDaemon from '../../src/startDaemon';
import { ByteCount, byteCount, durationMsec, DurationMsec, durationMsecToNumber } from '../../src/udp/UdpCongestionManager';

const mockChannelName = 'mock-channel' as any as ChannelName

class MockNodeDaemonGroup {
    #daemons = new Map<NodeId, MockNodeDaemon>()
    constructor() {

    }
    stop() {
        this.#daemons.forEach((daemon, nodeId) => {
            daemon.stop()
        })
        // this.#daemons.clear()
    }
    async createDaemon(opts: {bootstrapAddresses: Address[], isBootstrap: boolean, channelNames: ChannelName[], multicastUdpAddress: string | null, udpListenPort: Port | null, webSocketListenPort: Port | null}) {
        const daemon = new MockNodeDaemon(this, opts)
        await daemon.initialize()
        this.#daemons.set(daemon.nodeId(), daemon)
        return daemon
    }
    getDaemon(nodeId: NodeId) {
        return this.#daemons.get(nodeId) || null
    }
    async mockHttpPostJson(address: Address, path: UrlPath, data: JSONObject, opts: {timeoutMsec: DurationMsec}): Promise<JSONObject> {
        const nodeId = address.hostName.toString()
        if (isNodeId(nodeId)) {
            const daemon = this.getDaemon(nodeId)
            if (!daemon) {
                throw Error(`No daemon: ${nodeId}`)
            }
            const responseMessage = await daemon.mockPublicApiPost(path.toString(), data)
            return responseMessage
        }
        
        throw Error('mock - unable to process http post json')
    }
    async mockHttpGetDownload(address: Address, path: UrlPath): Promise<DataStreamy> {
        const nodeId = address.hostName.toString()
        if (isNodeId(nodeId)) {
            const daemon = this.getDaemon(nodeId)
            if (!daemon) {
                throw Error(`No daemon: ${nodeId}`)
            }
            return await daemon.mockPublicApiGetDownload(path.toString())
        }
        
        throw Error('mock - unable to process http get download')
    }
}

type DgramSocketType = 'udp4' | 'udp6'

interface BoundSocket {
    id: string
    socket: MockDgramSocket
    port: Port
}

class MockDgramSocketManager {
    #boundSockets: BoundSocket[] = []
    constructor() {
    }
    bind(id: string, port: Port, socket: MockDgramSocket) {
        this.#boundSockets.push({
            id,
            socket,
            port
        })
    }
    unbind(id: string) {
        this.#boundSockets = this.#boundSockets.filter(x => (x.id !== id))
    }
    socketsBelongingToAddress(address: string, port: Port) {
        return this.#boundSockets.filter(x => {
            return ((x.socket.hasMembership(address))  && (x.port === port))
        }).map(x => (x.socket))
    }
}
const dgramSocketManager = new MockDgramSocketManager()

class MockDgramSocket {
    #id = randomAlphaString(10)
    #type: DgramSocketType
    #reuseAddr: boolean
    #hostName: HostName
    #bound = false
    #port: Port = 0 as any as Port
    #onListeningCallbacks: (() => void)[] = []
    #onMessageCallbacks: ((message: Buffer, rinfo: DgramRemoteInfo) => void)[] = []
    #memberships = new Set<string>()
    constructor(args: {type: DgramSocketType, reuseAddr: boolean, hostName: HostName}) {
        this.#type = args.type
        this.#reuseAddr = args.reuseAddr
        this.#hostName = args.hostName
    }
    bind(port: number) {
        dgramSocketManager.bind(this.#id, port as any as Port, this)
        this.#bound = true
        this.#port = port as any as Port
        this.#onListeningCallbacks.forEach(cb => {cb()})
    }
    hasMembership(a: string) {
        return this.#memberships.has(a)
    }
    close() {
        dgramSocketManager.unbind(this.#id)
    }
    on(eventName: 'listening' | 'message', callback: (() => void) | ((message: Buffer, rinfo: DgramRemoteInfo) => void)) {
        if (eventName === 'listening') {
            this.#onListeningCallbacks.push(callback as (() => void))
            if (this.#bound) {
                this.#onListeningCallbacks.forEach(cb => {cb()})
            }
        }
        else if (eventName === 'message') {
            this.#onMessageCallbacks.push(callback as ((message: Buffer, rinfo: DgramRemoteInfo) => void))
        }
    }
    addMembership(address: string) {
        this.#memberships.add(address)
    }
    send(message: Buffer, offset: number, length: number, port: number, address: string, callback?: (err: Error | null, numBytesSent: number) => void) {
        const sockets = dgramSocketManager.socketsBelongingToAddress(address, port as any as Port)
        sockets.forEach(socket => {
            const rinfo: DgramRemoteInfo = {
                address: this.#hostName.toString(),
                family: 'IPv4',
                port: this.#port as any as number,
                size: 0
            }
            socket._handleMessage(message, rinfo)
        })
        callback && callback(null, message.length)
    }
    _handleMessage(message: Buffer, rinfo: DgramRemoteInfo) {
        this.#onMessageCallbacks.forEach(cb => {
            cb(message, rinfo)
        })
    }
}

const mockDgramCreateSocket: DgramCreateSocketFunction = (args: {type: 'udp4', reuseAddr: boolean, nodeId: NodeId}) => {
    const s = new MockDgramSocket({type: args.type, reuseAddr: args.reuseAddr, hostName: args.nodeId as any as HostName})
    s.addMembership(args.nodeId.toString())
    return s
}


class MockKacheryStorageManager {
    #mockFiles = new Map<Sha1Hash, Buffer>() 
    async findFile(fileKey: FileKey):  Promise<{found: boolean, size: ByteCount}> {
        const content = this.#mockFiles.get(fileKey.sha1)
        if (content) {
            return {
                found: true,
                size: byteCount(content.length)
            }
        }
        else {
            return {
                found: false,
                size: byteCount(0)
            }
        }
    }
    async getFileReadStream(fileKey: FileKey): Promise<DataStreamy> {
        const content = this.#mockFiles.get(fileKey.sha1)
        if (content) {
            const ret = new DataStreamy()
            setTimeout(() => {
                ret._start(byteCount(content.length))
                ret._data(content)
                ret._end()
            }, 2)
            return ret
        }
        else {
            throw Error('File not found')
        }
    }
    addMockFile(content: Buffer): FileKey {
        const shasum = crypto.createHash('sha1')
        shasum.update(content)
        const sha1 = shasum.digest('hex') as any as Sha1Hash
        this.#mockFiles.set(sha1, content)
        return {
            sha1
        }
    }
}

interface MockWebSocketUrl extends String {
    __mockWebSocketUrl__: never
}
const mockWebSocketUrl = (x: string) => {
    return x as any as MockWebSocketUrl
}

interface MockWebSocketId extends String {
    __webSocketId__: never
}
const createMockWebSocketId = () => {
    return randomAlphaString(10) as any as MockWebSocketId
}

class MockWebSocketServer {
    #incomingConnections = new Map<MockWebSocketId, MockWebSocket>()
    #onListeningCallbacks: (() => void)[] = []
    #onConnectionCallbacks: ((ws: WebSocketInterface) => void)[] = []
    #listening = false
    constructor(private port: Port, private nodeId: NodeId) {
        mockWebSocketManager.startServer(port, nodeId, this)
        this.#listening = true
    }
    onListening(callback: () => void) {
        if (this.#listening) {
            setTimeout(() => {
                callback()
            }, 1)
        }
        this.#onListeningCallbacks.push(callback as (() => void))
    }
    onConnection(callback: (ws: WebSocketInterface) => void) {
        this.#incomingConnections.forEach(ws => {
            setTimeout(() => {
                callback(ws)
            }, 1)
        })
        this.#onConnectionCallbacks.push(callback as ((ws: WebSocketInterface) => void))
    }
    close() {
        this.#incomingConnections.forEach(ws => {
            ws.close()
        })
        mockWebSocketManager.stopServer(this.port, this.nodeId)
    }
    _addConnection(ws: MockWebSocket) {
        const incomingWs = new MockWebSocket(null, {timeoutMsec: durationMsec(0)})
        incomingWs._setCompanion(ws)
        this.#incomingConnections.set(ws._id(), ws)
        this.#onConnectionCallbacks.forEach(cb => {
            cb(incomingWs)
        })
    }
}

type CB1 = (code: number, reason: string) => void
type CB2 = (err: Error | null) => void
type CB3 = (buf: Buffer) => void

class MockWebSocket {
    #id = createMockWebSocketId()
    #onOpenCallbacks: (() => void)[] = []
    #onCloseCallbacks: CB1[] = []
    #onErrorCallbacks: CB2[] = []
    #onMessageCallbacks: CB3[] = []
    #open = false
    #companion: MockWebSocket | null = null
    constructor(url: MockWebSocketUrl | null, opts: {timeoutMsec: DurationMsec}) {
        if (url) {
            this._connectToServer(url, opts)
        }
    }
    onOpen(callback: () => void) {
        if (this.#open) {
            callback()
        }
        this.#onOpenCallbacks.push(callback)
    }
    onClose(callback: CB1) {
        this.#onCloseCallbacks.push(callback)
    }
    onError(callback: CB2) {
        this.#onErrorCallbacks.push(callback)
    }
    onMessage(callback: CB3) {
        this.#onMessageCallbacks.push(callback)
    }
    close() {
        if (this.#open) {
            this.#open = false
            this.#onCloseCallbacks.forEach(cb => {cb(0, '')})
            if (this.#companion) {
                this.#companion.close()
            }
            this.#companion = null
        }
    }
    send(buf: Buffer) {
        if (!this.#open) {
            this._handleError(Error('Cannot send, websocket is closed'))
            return
        }
        if (!this.#companion) {
            this._handleError(Error('Cannot send, no websocket companion'))
            return
        }
        const companion = this.#companion
        setTimeout(() => {
            companion._handleIncomingMessage(buf)
        }, 2)
    }
    _id() {
        return this.#id
    }
    _connectToServer(url: MockWebSocketUrl, opts: {timeoutMsec: DurationMsec}) {
        (async () => {
            const timer = nowTimestamp()
            while (true) {
                const S: MockWebSocketServer | null = mockWebSocketManager.findServer(url)
                if (S) {
                    S._addConnection(this)
                    return
                }
                else {
                    if (elapsedSince(timer) > durationMsecToNumber(opts.timeoutMsec)) {
                        this._handleError(Error(`Unable to find websocket server: ${url}`))
                        return
                    }
                    else {
                        await sleepMsec(1)
                    }
                }
            }
        })()
    }
    _handleError(err: Error) {
        this.#onErrorCallbacks.forEach(cb => {
            cb(err)
        })
        if (this.#open) {
            this.close()
        }
    }
    _handleIncomingMessage(buf: Buffer) {
        this.#onMessageCallbacks.forEach(cb => {
            cb(buf)
        })
    }
    _setCompanion(c: MockWebSocket) {
        if (!this.#open) {
            this.#open = true
            this.#companion = c
            c._setCompanion(this)
            this.#onOpenCallbacks.forEach(cb => {cb()})
        }
    }
}

class MockWebSocketManager {
    #webSockets = new Map<MockWebSocketId, MockWebSocket>()
    #webSocketServers = new Map<MockWebSocketUrl, MockWebSocketServer>()
    constructor() {
    }
    startServer(port: Port, nodeId: NodeId, server: MockWebSocketServer) {
        const url = mockWebSocketUrl(`ws://${nodeId.toString()}:${port as any as number}`)
        this.#webSocketServers.set(url, server)
    }
    stopServer(port: Port, nodeId: NodeId) {
        const url = mockWebSocketUrl(`ws://${nodeId.toString()}:${port as any as number}`)
        this.#webSocketServers.delete(url)
    }
    findServer(url: MockWebSocketUrl) {
        return this.#webSocketServers.get(url) || null
    }
}
const mockWebSocketManager = new MockWebSocketManager()


const mockCreateWebSocketServer = (port: Port, nodeId: NodeId): WebSocketServerInterface => {
    return new MockWebSocketServer(port, nodeId)
}

const mockCreateWebSocket = (url: string, opts: {timeoutMsec: DurationMsec}): WebSocketInterface => {
    return new MockWebSocket(url as any as MockWebSocketUrl, opts)
}

class MockNodeDaemon {
    #daemonGroup: MockNodeDaemonGroup
    #keyPair = createKeyPair()
    #d: {
        publicApiServer: PublicApiServer,
        daemonApiServer: DaemonApiServer,
        stop: Function,
        node: KacheryP2PNode
    } | null = null
    #mockKacheryStorageManager = new MockKacheryStorageManager()
    constructor(daemonGroup: MockNodeDaemonGroup, private opts: {
        bootstrapAddresses: Address[],
        isBootstrap: boolean,
        channelNames: ChannelName[],
        multicastUdpAddress: string | null,
        udpListenPort: Port | null,
        webSocketListenPort: Port | null
    }) {
        this.#daemonGroup = daemonGroup
    }
    address(): Address {
        return {
            hostName: this.nodeId() as any as HostName,
            port: 20 as any as Port
        }
    }

    async initialize() {
        const externalInterface = {
            httpPostJsonFunction: (address: Address, path: UrlPath, data: JSONObject, opts: {timeoutMsec: DurationMsec}) => (this.#daemonGroup.mockHttpPostJson(address, path, data, opts)),
            httpGetDownloadFunction: (address: Address, path: UrlPath) => (this.#daemonGroup.mockHttpGetDownload(address, path)),
            dgramCreateSocketFunction: mockDgramCreateSocket,
            createWebSocketServerFunction: mockCreateWebSocketServer,
            createWebSocketFunction: mockCreateWebSocket,
            kacheryStorageManager: this.#mockKacheryStorageManager,
        }
        this.#d = await startDaemon({
            channelNames: this.opts.channelNames,
            keyPair: this.#keyPair,
            verbose: 0,
            hostName: null,
            daemonApiPort: null,
            httpListenPort: null,
            webSocketListenPort: this.opts.webSocketListenPort,
            udpListenPort: this.opts.udpListenPort,
            label: 'mock-daemon',
            bootstrapAddresses: this.opts.bootstrapAddresses,
            externalInterface,
            opts: {
                noBootstrap: (this.opts.bootstrapAddresses.length === 0),
                isBootstrapNode: this.opts.isBootstrap,
                mock: true,
                multicastUdpAddress: this.opts.multicastUdpAddress
            }    
        })
    }
    stop() {
        if (this.#d) {
            this.#d.stop()
        }
    }
    node() {
        if (!this.#d) {
            throw Error('mock daemon not yet initialized')
        }
        return this.#d.node
    }
    remoteNodeManager() {
        return this.node().remoteNodeManager()
    }
    nodeId() {
        return this.node().nodeId()
    }
    keyPair() {
        return this.node().keyPair()
    }
    mockKacheryStorageManager() {
        return this.#mockKacheryStorageManager
    }
    async mockPublicApiPost(path: string, data: JSONObject): Promise<JSONObject> {
        if (!this.#d) {
            throw Error('mock daemon not yet initialized')
        }
        return await this.#d.publicApiServer.mockPostJson(path, data)
    }
    async mockPublicApiGetDownload(path: string): Promise<DataStreamy> {
        if (!this.#d) {
            throw Error('mock daemon not yet initialized')
        }
        return await this.#d.publicApiServer.mockGetDownload(path)
    }
    async mockDaemonApiPost(path: string, data: JSONObject): Promise<JSONObject> {
        if (!this.#d) {
            throw Error('mock daemon not yet initialized')
        }
        return await this.#d.daemonApiServer.mockPostJson(path, data)
    }
    mockDaemonApiServer() {
        if (!this.#d) {
            throw Error('mock daemon not yet initialized')
        }
        return this.#d.daemonApiServer
    }
    async mockDaemonPostFindFile(reqData: ApiFindFileRequest): Promise<{
        onFound: (callback: (result: FindFileResult) => void) => void;
        onFinished: (callback: () => void) => void;
        cancel: () => void;
    }> {
        if (!this.#d) {
            throw Error('mock daemon not yet initialized')
        }
        return await this.#d.daemonApiServer.mockPostFindFile(reqData)
    }
}

const testContext = (testFunction: (g: MockNodeDaemonGroup, resolve: () => void, reject: (err: Error) => void) => Promise<void>, done: (err?: Error) => void) => {
    const g = new MockNodeDaemonGroup()
    const resolve = () => {
        g.stop()
        done()
    }
    const reject = (err: Error) => {
        g.stop()
        done(err)
    }
    testFunction(g, resolve, reject).then(() => {
    }).catch((err: Error) => {
        reject(err)
    })
}

 // need to explicitly use mocha prefix once or the dependency gets wrongly cleaned up
 mocha.describe('Integration', () => {
    describe('Test connect to bootstrap node', () => {
        it('Create this node and bootstrap node', (done) => {
            testContext(async (g, resolve, reject) => {
                const bootstrapDaemon = await g.createDaemon({bootstrapAddresses: [], isBootstrap: true, channelNames: [], multicastUdpAddress: null, udpListenPort: null, webSocketListenPort: null})
                const daemon1 = await g.createDaemon({bootstrapAddresses: [bootstrapDaemon.address()], isBootstrap: false, channelNames: [mockChannelName], multicastUdpAddress: null, udpListenPort: null, webSocketListenPort: null})
                // we expect to have no bootstrap nodes (yet)
                expect(daemon1.remoteNodeManager().getBootstrapRemoteNodes().length).equals(0)

                // wait a bit
                await sleepMsec(100)

                // we expect to have one bootstrap node
                expect(daemon1.remoteNodeManager().getBootstrapRemoteNodes().length).equals(1)
                const remoteBootstrapNode = daemon1.remoteNodeManager().getBootstrapRemoteNodes()[0]

                // Check that the node ID matches
                expect(remoteBootstrapNode.remoteNodeId()).equals(bootstrapDaemon.nodeId())

                // Check that the bootstrap node is aware of this node
                expect(bootstrapDaemon.remoteNodeManager().getAllRemoteNodes().length).equals(1)
                const remoteThisNode = bootstrapDaemon.remoteNodeManager().getAllRemoteNodes()[0]
                expect(remoteThisNode.remoteNodeId()).equals(daemon1.nodeId())
                expect(remoteThisNode.getChannelNames().includes(mockChannelName)).is.true

                resolve()
            }, done)
        })
        it('Find file on bootstrap node', (done) => {
            testContext(async (g, resolve, reject) => {
                const bootstrapDaemon = await g.createDaemon({bootstrapAddresses: [], isBootstrap: true, channelNames: [mockChannelName], multicastUdpAddress: null, udpListenPort: null, webSocketListenPort: null})
                const daemon1 = await g.createDaemon({bootstrapAddresses: [bootstrapDaemon.address()], isBootstrap: false, channelNames: [mockChannelName], multicastUdpAddress: null, udpListenPort: null, webSocketListenPort: null})

                const f1Content = Buffer.from('123456')
                const f1Key = bootstrapDaemon.mockKacheryStorageManager().addMockFile(f1Content)

                // wait a bit
                await sleepMsec(100)

                let numFound = 0
                const a = await daemon1.mockDaemonPostFindFile({
                    fileKey: f1Key,
                    timeoutMsec: durationMsec(100),
                    fromChannel: null
                })
                a.onFinished(() => {
                    expect(numFound).equals(1)
                    resolve()
                })
                a.onFound((result) => {
                    expect(result.fileKey.sha1).equals(f1Key.sha1)
                    numFound ++
                })
            }, done)
        })
    })
    describe('Test multicast udp discovery', () => {
        it('Create two nodes communicating through multicast sockets', (done) => {
            testContext(async (g, resolve, reject) => {
                const multicastUdpAddress = 'mock-multicast-udp-address-1'
                const daemon1 = await g.createDaemon({bootstrapAddresses: [], isBootstrap: false, channelNames: [mockChannelName], multicastUdpAddress, udpListenPort: randomMockPort(), webSocketListenPort: null})
                const daemon2 = await g.createDaemon({bootstrapAddresses: [], isBootstrap: false, channelNames: [mockChannelName], multicastUdpAddress, udpListenPort: randomMockPort(), webSocketListenPort: null})
                // // we expect to have no remote nodes yet
                expect(daemon1.remoteNodeManager().getAllRemoteNodes().length).equals(0)
                expect(daemon2.remoteNodeManager().getAllRemoteNodes().length).equals(0)

                // // wait a bit
                await sleepMsec(50)

                // // we expect to have one remote node now
                expect(daemon1.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).equals(1)
                expect(daemon2.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).equals(1)

                resolve()
            }, done)
        })
        it('Find file between two local nodes', (done) => {
            testContext(async (g, resolve, reject) => {
                const multicastUdpAddress = 'mock-multicast-udp-address-1'
                const daemon1 = await g.createDaemon({bootstrapAddresses: [], isBootstrap: false, channelNames: [mockChannelName], multicastUdpAddress, udpListenPort: randomMockPort(), webSocketListenPort: null})
                const daemon2 = await g.createDaemon({bootstrapAddresses: [], isBootstrap: false, channelNames: [mockChannelName], multicastUdpAddress, udpListenPort: randomMockPort(), webSocketListenPort: null})

                // // wait a bit
                await sleepMsec(50)

                await testFindFile(daemon1, daemon2)
                // await testLoadFile(daemon1, daemon2)

                resolve()
            }, done)
        })
    })
    describe('Test proxy connections', () => {
        it('Create two nodes communicating through proxy server', (done) => {
            testContext(async (g, resolve, reject) => {
                const bootstrapDaemon = await g.createDaemon({bootstrapAddresses: [], isBootstrap: true, channelNames: [], multicastUdpAddress: null, udpListenPort: null, webSocketListenPort: randomMockPort()})
                const daemon1 = await g.createDaemon({bootstrapAddresses: [bootstrapDaemon.address()], isBootstrap: false, channelNames: [mockChannelName], multicastUdpAddress: null, udpListenPort: null, webSocketListenPort: null})
                const daemon2 = await g.createDaemon({bootstrapAddresses: [bootstrapDaemon.address()], isBootstrap: false, channelNames: [mockChannelName], multicastUdpAddress: null, udpListenPort: null, webSocketListenPort: null})
                // // we expect to have no remote nodes yet
                expect(daemon1.remoteNodeManager().getAllRemoteNodes().length).equals(0)
                expect(daemon2.remoteNodeManager().getAllRemoteNodes().length).equals(0)

                // // wait a bit
                await sleepMsec(50)

                // // we expect to have one remote node now
                expect(daemon1.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).equals(1)
                expect(daemon2.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).equals(1)

                await testFindFile(daemon1, daemon2)
                await testLoadFile(daemon1, daemon2)

                resolve()
            }, done)
        })
    })
 })

const testFindFile = async (daemon1: MockNodeDaemon, daemon2: MockNodeDaemon) => {
    const f1Content = Buffer.from('123456')
    const f1Key = daemon1.mockKacheryStorageManager().addMockFile(f1Content)

    let numFound = 0
    const a = await daemon2.mockDaemonPostFindFile({
        fileKey: f1Key,
        timeoutMsec: durationMsec(100),
        fromChannel: null
    })
    return new Promise((resolve, reject) => {
        a.onFinished(() => {
            expect(numFound).equals(1)
            resolve()
        })
        a.onFound((result) => {
            expect(result.fileKey.sha1).equals(f1Key.sha1)
            numFound ++
        })
    })
}

const testLoadFile = async (daemon1: MockNodeDaemon, daemon2: MockNodeDaemon) => {
    const f1Content = Buffer.from('123456')
    const f1Key = daemon1.mockKacheryStorageManager().addMockFile(f1Content)

    return new Promise((resolve, reject) => {
        const reqData = {
            fileKey: f1Key,
            fromNode: daemon1.nodeId()
        } as any as JSONObject
        const x = daemon2.mockDaemonApiServer().mockPostLoadFile(reqData)
        x.onError(err => {
            reject(err)
        })
        x.onFinished(() => {
            resolve()
        })
    })
}

let lastMockPort = 0
const randomMockPort = () => {
    lastMockPort ++
    return lastMockPort as any as Port
}