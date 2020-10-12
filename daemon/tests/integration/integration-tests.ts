import { expect } from 'chai';
import * as mocha from 'mocha'; // import types for mocha e.g. describe
import { UrlPath } from '../../src/common/httpPostJson';
import { randomAlphaString, sleepMsec } from '../../src/common/util';
import { Address, ChannelName, HostName, isNodeId, JSONObject, NodeId, Port } from '../../src/interfaces/core';
import KacheryP2PNode, { DgramRemoteInfo } from '../../src/KacheryP2PNode';
import { LocalFilePath } from '../../src/kacheryStorage/KacheryStorageManager';
import PublicApiServer from '../../src/services/PublicApiServer';
import startDaemon from '../../src/startDaemon';
import { DurationMsec } from '../../src/udp/UdpCongestionManager';

const mockChannelName = 'mock-channel' as any as ChannelName

class MockNodeDaemonGroup {
    #daemons = new Map<NodeId, MockNodeDaemon>()
    constructor() {

    }
    stop() {
        this.#daemons.forEach((daemon, nodeId) => {
            daemon.stop()
        })
        this.#daemons.clear()
    }
    async createDaemon(opts: {bootstrapAddresses: Address[], isBootstrap: boolean, channelNames: ChannelName[], useMulticastUdp: boolean, udpListenPort: Port | null}) {
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
                throw Error('No daemon.')
            }
            const responseMessage = await daemon.mockPublicApiPost(path.toString(), data)
            return responseMessage
        }
        
        throw Error('mock - unable to process http post json')
    }
}

type DgramSocketType = 'udp4' | 'udp6'

interface BoundSocket {
    id: string
    socket: MockDgramSocket
    port: Port
    memberships: Set<string>
}

class MockDgramSocketManager {
    #boundSockets: BoundSocket[] = []
    constructor() {
    }
    bind(id: string, port: Port, socket: MockDgramSocket) {
        this.#boundSockets.push({
            id,
            socket,
            port,
            memberships: new Set<string>()
        })
    }
    unbind(id: string) {
        this.#boundSockets = this.#boundSockets.filter(x => (x.id !== id))
    }
    socketsBelongingToAddress(address: string, port: Port) {
        return this.#boundSockets.filter(x => {
            return ((x.memberships.has(address)) || (address === 'mock-udp-address')) && (x.port === port)
        }).map(x => (x.socket))
    }
    addMembership(id: string, address: string) {
        this.#boundSockets.forEach(x => {
            if (x.id === id) {
                x.memberships.add(address)
            }
        })
    }
}
const dgramSocketManager = new MockDgramSocketManager()

class MockDgramSocket {
    #id = randomAlphaString(10)
    #type: DgramSocketType
    #reuseAddr: boolean
    #bound = false
    #port: Port = 0 as any as Port
    #onListeningCallbacks: (() => void)[] = []
    #onMessageCallbacks: ((message: Buffer, rinfo: DgramRemoteInfo) => void)[] = []
    constructor(args: {type: DgramSocketType, reuseAddr: boolean}) {
        this.#type = args.type
        this.#reuseAddr = args.reuseAddr
    }
    bind(port: number) {
        dgramSocketManager.bind(this.#id, port as any as Port, this)
        this.#bound = true
        this.#port = port as any as Port
        this.#onListeningCallbacks.forEach(cb => {cb()})
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
        dgramSocketManager.addMembership(this.#id, address)
    }
    send(message: Buffer, offset: number, length: number, port: number, address: string) {
        const sockets = dgramSocketManager.socketsBelongingToAddress(address, port as any as Port)
        sockets.forEach(socket => {
            const rinfo: DgramRemoteInfo = {
                address: 'mock-udp-address',
                family: 'IPv4',
                port: this.#port as any as number,
                size: 0
            }
            socket._handleMessage(message, rinfo)
        })
    }
    _handleMessage(message: Buffer, rinfo: DgramRemoteInfo) {
        this.#onMessageCallbacks.forEach(cb => {
            cb(message, rinfo)
        })
    }
}

const mockDgramCreateSocket = (args: {type: 'udp4', reuseAddr: boolean}) => {
    return new MockDgramSocket(args)
}

class MockNodeDaemon {
    #daemonGroup: MockNodeDaemonGroup
    #d: {
        publicApiServer: PublicApiServer,
        stop: Function,
        node: KacheryP2PNode
    } | null = null
    constructor(daemonGroup: MockNodeDaemonGroup, private opts: {
        bootstrapAddresses: Address[],
        isBootstrap: boolean,
        channelNames: ChannelName[],
        useMulticastUdp: boolean,
        udpListenPort: Port | null
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
        this.#d = await startDaemon({
            channelNames: this.opts.channelNames,
            configDir: 'mock-config-dir' as any as LocalFilePath,
            verbose: 0,
            hostName: null,
            daemonApiPort: null,
            httpListenPort: null,
            webSocketListenPort: null,
            udpListenPort: this.opts.udpListenPort,
            label: 'mock-daemon',
            bootstrapAddresses: this.opts.bootstrapAddresses,
            httpPostJsonFunction: (address: Address, path: UrlPath, data: JSONObject, opts: {timeoutMsec: DurationMsec}) => (this.#daemonGroup.mockHttpPostJson(address, path, data, opts)),
            dgramCreateSocketFunction: mockDgramCreateSocket,
            opts: {
                noBootstrap: (this.opts.bootstrapAddresses.length === 0),
                isBootstrapNode: this.opts.isBootstrap,
                mock: true,
                useMulticastUdp: this.opts.useMulticastUdp
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
    nodeId() {
        return this.node().nodeId()
    }
    keyPair() {
        return this.node().keyPair()
    }
    async mockPublicApiPost(path: string, data: JSONObject): Promise<JSONObject> {
        if (!this.#d) {
            throw Error('mock daemon not yet initialized')
        }
        return await this.#d.publicApiServer.mockPostJson(path, data)
    }
}

 // need to explicitly use mocha prefix once or the dependency gets wrongly cleaned up
 mocha.describe('Integration', () => {
    describe('Test connect to bootstrap node', () => {
        // it('Create this node and bootstrap node', (done) => {
        //     (async () => {
        //         const g = new MockNodeDaemonGroup()
        //         const bootstrapDaemon = await g.createDaemon({bootstrapAddresses: [], isBootstrap: true, channelNames: [], useMulticastUdp: false, udpListenPort: null})
        //         const thisDaemon = await g.createDaemon({bootstrapAddresses: [bootstrapDaemon.address()], isBootstrap: false, channelNames: [mockChannelName], useMulticastUdp: false, udpListenPort: null})
        //         // we expect to have no bootstrap nodes (yet)
        //         expect(thisDaemon.node().remoteNodeManager().getBootstrapRemoteNodes().length).equals(0)

        //         // wait a bit
        //         await sleepMsec(100)

        //         // we expect to have one bootstrap node
        //         expect(thisDaemon.node().remoteNodeManager().getBootstrapRemoteNodes().length).equals(1)
        //         const remoteBootstrapNode = thisDaemon.node().remoteNodeManager().getBootstrapRemoteNodes()[0]

        //         // Check that the node ID matches
        //         expect(remoteBootstrapNode.remoteNodeId()).equals(bootstrapDaemon.nodeId())

        //         // Check that the bootstrap node is aware of this node
        //         expect(bootstrapDaemon.node().remoteNodeManager().getAllRemoteNodes().length).equals(1)
        //         const remoteThisNode = bootstrapDaemon.node().remoteNodeManager().getAllRemoteNodes()[0]
        //         expect(remoteThisNode.remoteNodeId()).equals(thisDaemon.nodeId())
        //         expect(remoteThisNode.getChannelNames().includes(mockChannelName)).is.true

        //         g.stop()
        //         done()
        //     })()
        // })
        it('Create two nodes communicating through multicast sockets', (done) => {
            (async () => {
                const g = new MockNodeDaemonGroup()
                const daemon1 = await g.createDaemon({bootstrapAddresses: [], isBootstrap: false, channelNames: [mockChannelName], useMulticastUdp: true, udpListenPort: 1 as any as Port})
                const daemon2 = await g.createDaemon({bootstrapAddresses: [], isBootstrap: false, channelNames: [mockChannelName], useMulticastUdp: true, udpListenPort: 2 as any as Port})
                // // we expect to have no remote nodes yet
                expect(daemon1.node().remoteNodeManager().getAllRemoteNodes().length).equals(0)
                expect(daemon2.node().remoteNodeManager().getAllRemoteNodes().length).equals(0)

                // // wait a bit
                await sleepMsec(500)

                // // we expect to have one remote node now
                expect(daemon1.node().remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).equals(1)
                expect(daemon2.node().remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).equals(1)

                g.stop()
                done()
            })()
        })
    })
 })