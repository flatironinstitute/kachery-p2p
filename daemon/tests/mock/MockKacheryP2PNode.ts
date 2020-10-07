import { randomHexString } from '../../src/common/util';
import { Address, ChannelName, ChannelNodeInfo, exampleChannelNodeInfo, HostName, jsonObjectsMatch, NodeId, Port } from '../../src/interfaces/core';
import { AnnounceResponseData, isAnnounceRequestData, isProbeRequestData, NodeToNodeRequestData, NodeToNodeResponseData, ProbeResponseData } from '../../src/interfaces/NodeToNodeRequest';
import { daemonVersion, protocolVersion } from '../../src/protocolVersion';
import { SendRequestMethod } from '../../src/RemoteNode';
import { DurationMsec } from '../../src/udp/UdpCongestionManager';

export const mockChannelName = 'mock-channel' as any as ChannelName

export const createRandomNodeId = () => {
    return randomHexString(64) as any as NodeId
}

class MockRemoteNode {
    #remoteNodeId: NodeId = createRandomNodeId()
    #announcedChannelNodeInfo: ChannelNodeInfo | null = null
    #channelNames: ChannelName[]
    #isBootstrap: boolean
    #bootstrapAddress: Address | null
    #probed = false
    constructor(isBootstrap = true, channelNames: ChannelName[], bootstrapAddress: Address | null = null) {
        this.#isBootstrap = isBootstrap
        this.#channelNames = channelNames
        this.#bootstrapAddress = bootstrapAddress
    }
    remoteNodeId(): NodeId {
        return this.#remoteNodeId
    }
    isBootstrap() {
        return this.#isBootstrap
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
        else if (isProbeRequestData(requestData)) {
            this.#probed = true
            const responseData: ProbeResponseData = {
                requestType: 'probe',
                probeResponse: {
                    success: true,
                    protocolVersion: protocolVersion(),
                    daemonVersion: daemonVersion(),
                    nodeId: this.#remoteNodeId,
                    isBootstrapNode: this.#isBootstrap,
                    webSocketAddress: null,
                    publicUdpSocketAddress: null
                    
                }
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
    bootstrapAddress() {
        return this.#bootstrapAddress
    }
    mock_announcedChannelNodeInfo() {
        return this.#announcedChannelNodeInfo
    }
    mock_probed() {
        return this.#probed
    }
}

class MockRemoteNodeInChannels extends MockRemoteNode {
    constructor(channelNames: ChannelName[]) {
        super(true, channelNames)
    }
}

class MockBootstrapRemoteNode extends MockRemoteNode {
    constructor() {
        const bootstrapAddress: Address = {
            hostName: 'mock.host.name' as any as HostName,
            port: 12 as any as Port
        }
        super(true, [], bootstrapAddress)
    }
}

class MockRemoteNodeManager {
    #remoteNodes = new Map<NodeId, MockRemoteNode>()
    #onNodeChannelAddedCallbacks: ((remoteNodeId: NodeId, channelName: ChannelName) => void)[] = []
    #onBootstrapNodeAddedCallbacks: ((nodeId: NodeId) => void)[] = []
    constructor() {
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
        return Array.from(this.#remoteNodes.values()).filter(n => (n.isBootstrap()))
    }
    getRemoteNodesInChannel(channelName: ChannelName): MockRemoteNode[] {
        return Array.from(this.#remoteNodes.values()).filter(n => (n.channelNames().includes(channelName)))
    }
    async setBootstrapNode(remoteNodeId: NodeId, address: Address, webSocketAddress: Address | null, udpSocketAddress: Address | null) {
        const n = this.#remoteNodes.get(remoteNodeId)
        if (n) {
            if ((!n.isBootstrap()) || (!jsonObjectsMatch(n.bootstrapAddress(), address))) {
                this.#remoteNodes.delete(remoteNodeId);
            }
        }
        if (!this.#remoteNodes.has(remoteNodeId)) {
            const remoteNode = new MockRemoteNode(true, [], address)
            this.#remoteNodes.set(remoteNodeId, remoteNode)
            this.#onBootstrapNodeAddedCallbacks.forEach(cb => {
                cb(remoteNode.remoteNodeId())
            })
        }
    }
    mock_addBootstrapNode() {
        const n = new MockBootstrapRemoteNode()
        this.#remoteNodes.set(n.remoteNodeId(), n)
        this.#onBootstrapNodeAddedCallbacks.forEach(cb => {
            cb(n.remoteNodeId())
        })
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

export class MockKacheryP2PNode {
    #remoteNodeManager = new MockRemoteNodeManager()
    #bootstrapAddresses: Address[] = [{hostName: 'bootstrap-host-name' as any as HostName, port: 23 as any as Port}]
    remoteNodeManager() {
        return this.#remoteNodeManager
    }
    getChannelNodeInfo(channelName: ChannelName): ChannelNodeInfo {
        return exampleChannelNodeInfo
    }
    channelNames(): ChannelName[] {
        return [mockChannelName]
    }
    bootstrapAddresses() {
        return [...this.#bootstrapAddresses]
    }
}