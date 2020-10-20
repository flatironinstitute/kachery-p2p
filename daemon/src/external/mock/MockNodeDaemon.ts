import { createKeyPair } from "../../common/crypto_util"
import DataStreamy from "../../common/DataStreamy"
import { Address, ChannelName, DurationMsec, FindFileResult, hostName, isNodeId, JSONObject, NodeId, Port, toPort, UrlPath } from "../../interfaces/core"
import KacheryP2PNode from "../../KacheryP2PNode"
import DaemonApiServer, { ApiFindFileRequest } from "../../services/DaemonApiServer"
import PublicApiServer from "../../services/PublicApiServer"
import startDaemon from "../../startDaemon"
import mockExternalInterface from "./mockExternalInterface"
import MockKacheryStorageManager from './MockKacheryStorageManager'
import MockLocalFeedManager from "./MockLocalFeedManager"

export default class MockNodeDaemon {
    #daemonGroup: MockNodeDaemonGroup
    #keyPair = createKeyPair()
    #d: {
        publicApiServer: PublicApiServer,
        daemonApiServer: DaemonApiServer,
        stop: Function,
        node: KacheryP2PNode
    } | null = null
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
            hostName: hostName(this.nodeId().toString()),
            port: toPort(20)
        }
    }

    async initialize() {
        const externalInterface = mockExternalInterface(this.#daemonGroup)
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
        return this.node().kacheryStorageManager() as MockKacheryStorageManager
    }
    mockLocalFeedManager() {
        return this.node().feedManager().localFeedManager() as MockLocalFeedManager
    }
    feedManager() {
        return this.node().feedManager()
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

export class MockNodeDaemonGroup {
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
        else {
            throw Error('mock - unable to process http get download')
        }
    }
}