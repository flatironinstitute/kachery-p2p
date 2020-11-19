import DataStreamy from "../../common/DataStreamy"
import { randomAlphaString, sleepMsec } from "../../common/util"
import { Address, byteCount, DurationMsec, FindFileResult, hostName, isNodeId, JSONObject, NodeId, nodeLabel, scaledDurationMsec, toPort, UrlPath } from "../../interfaces/core"
import NodeStats from "../../NodeStats"
import { ApiFindFileRequest } from "../../services/DaemonApiServer"
import startDaemon, { DaemonInterface, StartDaemonOpts } from "../../startDaemon"
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
    #d: DaemonInterface | null = null
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
            configDir: null,
            verbose: 0,
            hostName: null,
            publicUrl: null,
            daemonApiPort: null,
            httpListenPort: null,
            label: nodeLabel('mock-daemon-' + randomAlphaString(5)),
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
        /* istanbul ignore next */
        if (!this.#d.node) throw Error('Unexpected')
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
        /* istanbul ignore next */
        if (!this.#d.publicApiServer) throw Error('unexpected')
        return await this.#d.publicApiServer.mockPostJson(path, data)
    }
    async mockPublicApiGetDownload(path: string): Promise<DataStreamy> {
        if (!this.#d) {
            /* istanbul ignore next */
            throw Error('mock daemon not yet initialized')
        }
        /* istanbul ignore next */
        if (!this.#d.publicApiServer) throw Error('unexpected')
        return await this.#d.publicApiServer.mockGetDownload(path)
    }
    async mockDaemonApiPost(path: string, data: JSONObject): Promise<JSONObject> {
        if (!this.#d) {
            /* istanbul ignore next */
            throw Error('mock daemon not yet initialized')
        }
        /* istanbul ignore next */
        if (!this.#d.daemonApiServer) throw Error('unexpected')
        return await this.#d.daemonApiServer.mockPostJson(path, data)
    }
    mockDaemonApiServer() {
        if (!this.#d) {
            /* istanbul ignore next */
            throw Error('mock daemon not yet initialized')
        }
        /* istanbul ignore next */
        if (!this.#d.daemonApiServer) throw Error('unexpected')
        return this.#d.daemonApiServer
    }
    async mockDaemonPostFindFile(reqData: ApiFindFileRequest): Promise<{
        onFound: (callback: (result: FindFileResult) => void) => void;
        onFinished: (callback: () => void) => void;
        cancel: () => void;
    }> {
        /* istanbul ignore next */
        if (!this.#d) throw Error('Unexpected. Mock daemon not yet initialized')
        /* istanbul ignore next */
        if (!this.#d.daemonApiServer) throw Error('unexpected')
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
        if (!address.hostName) throw Error('Unexpected in mockHttpPostJson')
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
    async mockHttpGetDownload(address: Address, path: UrlPath, stats: NodeStats, opts: {fromNodeId: NodeId}): Promise<DataStreamy> {
        if (!address.hostName) throw Error('Unexpected in mockHttpGetDownload')
        const nodeId = address.hostName.toString()
        if (isNodeId(nodeId)) {
            const daemon = this.getDaemon(nodeId)
            if (!daemon) {
                /* istanbul ignore next */
                throw Error(`No daemon: ${nodeId}`)
            }
            const ds = await daemon.mockPublicApiGetDownload(path.toString())
            ds.onData(d => {
                stats.reportBytesReceived('http', opts.fromNodeId, byteCount(d.length))
            })
            return ds
        }
        else {
            /* istanbul ignore next */
            throw Error('mock - unable to process http get download')
        }
    }
}