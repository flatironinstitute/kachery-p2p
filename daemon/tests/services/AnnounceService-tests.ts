import { expect } from 'chai';
import * as mocha from 'mocha'; // import types for mocha e.g. describe
import { randomAlphaString, sleepMsec } from '../../src/common/util';
import { ChannelName, ChannelNodeInfo, NodeId } from '../../src/interfaces/core';
import { AnnounceResponseData, isAnnounceRequestData, NodeToNodeRequestData, NodeToNodeResponseData } from '../../src/interfaces/NodeToNodeRequest';
import { SendRequestMethod } from '../../src/RemoteNode';
import AnnounceService from '../../src/services/AnnounceService';
import { DurationMsec, durationMsec } from '../../src/udp/UdpCongestionManager';
import { validNodeInfoBody } from '../interfaces/interface-tests';

const mockChannelName = 'mock-channel' as any as ChannelName

const createRandomNodeId = () => {
    return randomAlphaString(10) as any as NodeId
}

class MockRemoteNode {
    #remoteNodeId: NodeId = createRandomNodeId()
    #announcedChannelNodeInfo: ChannelNodeInfo | null = null
    #channelNames: ChannelName[]
    constructor(private isBootstrap = true, channelNames: ChannelName[]) {
        this.#channelNames = channelNames
    }
    remoteNodeId(): NodeId {
        return this.#remoteNodeId
    }
    isBootstrapNode() {
        return this.isBootstrap
    }
    async sendRequest(requestData: NodeToNodeRequestData, opts: {timeoutMsec: DurationMsec, method: SendRequestMethod}): Promise<NodeToNodeResponseData> {
        if (isAnnounceRequestData(requestData)) {
            this.#announcedChannelNodeInfo = requestData.channelNodeInfo
            const responseData: AnnounceResponseData = {
                requestType: 'announce',
                success: true,
                errorMessage: null
            }
            return responseData
        }
        else {
            throw Error('Not implemented in mock')
        }
    }
    channelNames() {
        return this.#channelNames
    }
    mock_announcedChannelNodeInfo() {
        return this.#announcedChannelNodeInfo
    }
}

class MockRemoteNodeInChannels extends MockRemoteNode {
    constructor(channelNames: ChannelName[]) {
        super(true, channelNames)
    }
}

class MockBootstrapRemoteNode extends MockRemoteNode {
    constructor() {
        super(true, [])
    }
}

class MockRemoteNodeManager {
    #remoteNodes = new Map<NodeId, MockRemoteNode>()
    #onNodeChannelAddedCallbacks: ((remoteNodeId: NodeId, channelName: ChannelName) => void)[] = []
    constructor() {
        const n1 = new MockBootstrapRemoteNode()
        this.#remoteNodes.set(n1.remoteNodeId(), n1)

        this.mock_addNewNodeInChannels([mockChannelName])
    }
    onNodeChannelAdded(callback: (remoteNodeId: NodeId, channelName: ChannelName) => void) {
        this.#onNodeChannelAddedCallbacks.push(callback)
    }
    async sendRequestToNode(remoteNodeId: NodeId, requestData: NodeToNodeRequestData, opts: {timeoutMsec: DurationMsec, method: SendRequestMethod}) {
        const n = this.#remoteNodes.get(remoteNodeId)
        if (!n) {
            throw Error('Unexpected')
        }
        return await n.sendRequest(requestData, opts)
    }
    getBootstrapRemoteNodes(): MockRemoteNode[] {
        return Array.from(this.#remoteNodes.values()).filter(n => (n.isBootstrapNode()))
    }
    getRemoteNodesInChannel(channelName: ChannelName): MockRemoteNode[] {
        return Array.from(this.#remoteNodes.values()).filter(n => (n.channelNames().includes(channelName)))
    }
    mock_addNewNodeInChannels(channelNames: ChannelName[]) {
        const n = new MockRemoteNodeInChannels(channelNames)
        this.#remoteNodes.set(n.remoteNodeId(), n)
        for (let channelName of channelNames) {
            this.#onNodeChannelAddedCallbacks.forEach(cb => {
                cb(n.remoteNodeId(), channelName)
            })
        }
    }
}

class MockKacheryP2PNode {
    #remoteNodeManager = new MockRemoteNodeManager()
    remoteNodeManager() {
        return this.#remoteNodeManager
    }
    getChannelNodeInfo(channelName: ChannelName): ChannelNodeInfo {
        return { body: validNodeInfoBody, signature: new Array(65).join('a') } as any as ChannelNodeInfo
    }
    channelNames(): ChannelName[] {
        return [mockChannelName]
    }
    isBootstrapNode(): boolean { return true } // TODO: CHECKME
}

 // need to explicitly use mocha prefix once or the dependency gets wrongly cleaned up
 mocha.describe('AnnounceService', () => {
    describe('Test announce', () => {
        it('Announce to bootstrap and nodes in channel', (done) => {
            (async () => {
                const node = new MockKacheryP2PNode()
                const announceService = new AnnounceService(node, {announceBootstrapIntervalMsec: durationMsec(3), announceToRandomNodeIntervalMsec: durationMsec(2)})
                expect(node.remoteNodeManager().getBootstrapRemoteNodes().length).is.greaterThan(0)
                expect(node.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).is.greaterThan(0)
                node.remoteNodeManager().getBootstrapRemoteNodes().forEach(n => {
                    expect(n.mock_announcedChannelNodeInfo()).is.null
                })
                node.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).forEach(n => {
                    expect(n.mock_announcedChannelNodeInfo()).is.null
                })
                await sleepMsec(40)
                node.remoteNodeManager().mock_addNewNodeInChannels([mockChannelName])
                expect(node.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).is.greaterThan(1)
                node.remoteNodeManager().getBootstrapRemoteNodes().forEach(n => {
                    expect(n.mock_announcedChannelNodeInfo()).is.not.null
                })
                node.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).forEach(n => {
                    expect(n.mock_announcedChannelNodeInfo()).is.not.null
                })
                announceService.stop()
                done()
            })()
        })
    })
 })