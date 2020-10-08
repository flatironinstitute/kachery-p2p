import { expect } from 'chai';
import * as mocha from 'mocha'; // import types for mocha e.g. describe
import { UrlPath } from '../../src/common/httpPostJson';
import { sleepMsec } from '../../src/common/util';
import { Address, ChannelName, HostName, isNodeId, JSONObject, NodeId, Port } from '../../src/interfaces/core';
import KacheryP2PNode from '../../src/KacheryP2PNode';
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
    async createDaemon(opts: {bootstrapAddresses: Address[], isBootstrap: boolean, channelNames: ChannelName[]}) {
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

class MockDgramSocket {
    bind(port: number) {
    }
    on(eventName: 'listening' | 'message', callback: (() => void) | ((message: JSONObject, rinfo: any) => void)) {
    }
    addMembership(address: string) {
    }
    send(message: string, offset: number, length: number, port: number, address: string) {
    }
}

const mockDgramCreateSocket = (args: {type: 'udp4', reuseAddr: boolean}) => {
    return new MockDgramSocket()
}

class MockNodeDaemon {
    #daemonGroup: MockNodeDaemonGroup
    #d: {
        publicApiServer: PublicApiServer,
        stop: Function,
        node: KacheryP2PNode
    } | null = null
    constructor(daemonGroup: MockNodeDaemonGroup, private opts: {bootstrapAddresses: Address[], isBootstrap: boolean, channelNames: ChannelName[]}) {
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
            udpListenPort: null,
            label: 'mock-daemon',
            bootstrapAddresses: this.opts.bootstrapAddresses,
            httpPostJsonFunction: (address: Address, path: UrlPath, data: JSONObject, opts: {timeoutMsec: DurationMsec}) => (this.#daemonGroup.mockHttpPostJson(address, path, data, opts)),
            dgramCreateSocketFunction: mockDgramCreateSocket,
            opts: {
                noBootstrap: (this.opts.bootstrapAddresses.length === 0),
                isBootstrapNode: this.opts.isBootstrap,
                mock: true
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
        it('Create this node and bootstrap node', (done) => {
            (async () => {
                const g = new MockNodeDaemonGroup()
                const bootstrapDaemon = await g.createDaemon({bootstrapAddresses: [], isBootstrap: true, channelNames: []})
                const thisDaemon = await g.createDaemon({bootstrapAddresses: [bootstrapDaemon.address()], isBootstrap: false, channelNames: [mockChannelName]})
                // we expect to have no bootstrap nodes (yet)
                expect(thisDaemon.node().remoteNodeManager().getBootstrapRemoteNodes().length).equals(0)

                // wait a bit
                await sleepMsec(100)

                // we expect to have one bootstrap node
                expect(thisDaemon.node().remoteNodeManager().getBootstrapRemoteNodes().length).equals(1)
                const remoteBootstrapNode = thisDaemon.node().remoteNodeManager().getBootstrapRemoteNodes()[0]

                // Check that the node ID matches
                expect(remoteBootstrapNode.remoteNodeId()).equals(bootstrapDaemon.nodeId())

                // Check that the bootstrap node is aware of this node
                expect(bootstrapDaemon.node().remoteNodeManager().getAllRemoteNodes().length).equals(1)
                const remoteThisNode = bootstrapDaemon.node().remoteNodeManager().getAllRemoteNodes()[0]
                expect(remoteThisNode.remoteNodeId()).equals(thisDaemon.nodeId())
                expect(remoteThisNode.getChannelNames().includes(mockChannelName)).is.true

                g.stop()
                done()
            })()
        })
    })
 })