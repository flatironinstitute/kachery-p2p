import { createKeyPair } from "../../common/crypto_util"
import DataStreamy from "../../common/DataStreamy"
import { randomAlphaString, sleepMsec } from "../../common/util"
import { Address, DurationMsec, FindFileResult, hostName, isNodeId, JSONObject, NodeId, scaledDurationMsec, toPort, UrlPath } from "../../interfaces/core"
import KacheryP2PNode from "../../KacheryP2PNode"
import DaemonApiServer, { ApiFindFileRequest } from "../../services/DaemonApiServer"
import PublicApiServer from "../../services/PublicApiServer"
import startDaemon, { StartDaemonOpts } from "../../startDaemon"
import mockExternalInterface from "./mockExternalInterface"
import MockKacheryStorageManager from './MockKacheryStorageManager'

export interface MockNodeDefects {
    fileReadDefect?: boolean
    badDownloadFileDataRequest?: boolean
    udpPacketLossNum?: number
    disconnectIncomingProxyConnectionOnce?: boolean
    createUdpSocketDefect?: boolean
}

export default class MockNodeDaemon {
    #daemonGroup: MockNodeDaemonGroup
    #keyPair = createKeyPair()
    #d: {
        publicApiServer: PublicApiServer,
        daemonApiServer: DaemonApiServer,
        stop: Function,
        node: KacheryP2PNode
    } | null = null
    #defects: MockNodeDefects = {}
    constructor(daemonGroup: MockNodeDaemonGroup, private opts: StartDaemonOpts) {
        this.#daemonGroup = daemonGroup
    }
    address(): Address {
        return {
            hostName: hostName(this.nodeId().toString()),
            port: toPort(20)
        }
    }

    defects() {
        return this.#defects
    }
    setDefects(defects: MockNodeDefects) {
        this.#defects = defects
    }
    clearDefects() {
        this.setDefects({})
    }

    async initialize() {
        const externalInterface = mockExternalInterface(this.#daemonGroup, () => (this.defects()))
        this.#d = await startDaemon({
            keyPair: this.#keyPair,
            verbose: 0,
            hostName: null,
            daemonApiPort: null,
            httpListenPort: null,
            label: 'mock-daemon-' + randomAlphaString(5),
            externalInterface,
            getDefects: () => (this.#defects),
            opts: this.opts  
        })
    }
    stop() {
        if (this.#d) {
            this.#d.stop()
        }
    }
    node() {
        if (!this.#d) {
            /* istanbul ignore next */
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
    mockKacheryStorageManager() {
        return this.node().kacheryStorageManager() as MockKacheryStorageManager
    }
    // feedManager() {
    //     return this.node().feedManager()
    // }
    async mockPublicApiPost(path: string, data: JSONObject): Promise<JSONObject> {
        if (!this.#d) {
            /* istanbul ignore next */
            throw Error('mock daemon not yet initialized')
        }
        return await this.#d.publicApiServer.mockPostJson(path, data)
    }
    async mockPublicApiGetDownload(path: string): Promise<DataStreamy> {
        if (!this.#d) {
            /* istanbul ignore next */
            throw Error('mock daemon not yet initialized')
        }
        return await this.#d.publicApiServer.mockGetDownload(path)
    }
    async mockDaemonApiPost(path: string, data: JSONObject): Promise<JSONObject> {
        if (!this.#d) {
            /* istanbul ignore next */
            throw Error('mock daemon not yet initialized')
        }
        return await this.#d.daemonApiServer.mockPostJson(path, data)
    }
    mockDaemonApiServer() {
        if (!this.#d) {
            /* istanbul ignore next */
            throw Error('mock daemon not yet initialized')
        }
        return this.#d.daemonApiServer
    }
    async mockDaemonPostFindFile(reqData: ApiFindFileRequest): Promise<{
        onFound: (callback: (result: FindFileResult) => void) => void;
        onFinished: (callback: () => void) => void;
        cancel: () => void;
    }> {
        /* istanbul ignore next */
        if (!this.#d) {
            throw Error('mock daemon not yet initialized')
        }
        return await this.#d.daemonApiServer.mockPostFindFile(reqData as any as JSONObject)
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
    async createDaemon(opts: StartDaemonOpts, initialDefects?: MockNodeDefects) {
        const daemon = new MockNodeDaemon(this, opts)
        if (initialDefects) {
            daemon.setDefects(initialDefects)
        }
        await daemon.initialize()
        this.#daemons.set(daemon.nodeId(), daemon)
        await sleepMsec(scaledDurationMsec(1000))
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
                /* istanbul ignore next */
                throw Error(`No daemon: ${nodeId}`)
            }
            const responseMessage = await daemon.mockPublicApiPost(path.toString(), data)
            return responseMessage
        }
        
        /* istanbul ignore next */
        throw Error('mock - unable to process http post json')
    }
    async mockHttpGetDownload(address: Address, path: UrlPath): Promise<DataStreamy> {
        const nodeId = address.hostName.toString()
        if (isNodeId(nodeId)) {
            const daemon = this.getDaemon(nodeId)
            if (!daemon) {
                /* istanbul ignore next */
                throw Error(`No daemon: ${nodeId}`)
            }
            return await daemon.mockPublicApiGetDownload(path.toString())
        }
        else {
            /* istanbul ignore next */
            throw Error('mock - unable to process http get download')
        }
    }
}