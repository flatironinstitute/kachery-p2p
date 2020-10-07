import * as mocha from 'mocha'; // import types for mocha e.g. describe
import { ChannelName, ChannelNodeInfo, exampleChannelNodeInfo, NodeId } from '../../src/interfaces/core';
import { NodeToNodeRequestData, NodeToNodeResponseData } from '../../src/interfaces/NodeToNodeRequest';
import { daemonVersion, protocolVersion } from '../../src/protocolVersion';
import { SendRequestMethod } from '../../src/RemoteNode';
import AnnounceService from '../../src/services/AnnounceService';
import { DurationMsec, durationMsec } from '../../src/udp/UdpCongestionManager';

class MockRemoteNode {
    remoteNodeId(): NodeId {
        return 'a' as any as NodeId
    }
}

class MockRemoteNodeManager {
    onNodeChannelAdded(callback: (remoteNodeId: NodeId, channelName: ChannelName) => void) {

    }
    async sendRequestToNode(remoteNodeId: NodeId, requestData: NodeToNodeRequestData, opts: {timeoutMsec: DurationMsec, method: SendRequestMethod}) {
        const responseData: NodeToNodeResponseData = {
            requestType: 'probe',
            probeResponse: {
                success: false,
                protocolVersion: protocolVersion(),
                daemonVersion: daemonVersion(),
                nodeId: 'a' as any as NodeId,
                isBootstrapNode: false,
                webSocketAddress: null,
                publicUdpSocketAddress: null
            }
        }
        return responseData
    }
    getBootstrapRemoteNodes(): MockRemoteNode[] {
        return []
    }
    getRemoteNodesInChannel(channelName: ChannelName): MockRemoteNode[] {
        return []
    }
}

class MockKacheryP2PNode {
    #remoteNodeManager = new MockRemoteNodeManager()
    remoteNodeManager() {
        return this.#remoteNodeManager
    }
    getChannelNodeInfo(channelName: ChannelName): ChannelNodeInfo {
        return exampleChannelNodeInfo
    }
    channelNames(): ChannelName[] {
        return []
    }
}

 // need to explicitly use mocha prefix once or the dependency gets wrongly cleaned up
 mocha.describe('AnnounceService', () => {
    describe('Test announce', () => {
        it('Announce to bootstrap and nodes in channel', async () => {
            return new Promise((resolve, reject) => {
                (async () => {
                    const node = new MockKacheryP2PNode()
                    const announceService = new AnnounceService(node, {announceBootstrapIntervalMsec: durationMsec(3), announceToRandomNodeIntervalMsec: durationMsec(2)})
                    resolve()
                    announceService.stop()
                })()
            })
        })
    })
 })