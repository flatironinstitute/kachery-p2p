import { expect } from 'chai';
import * as mocha from 'mocha'; // import types for mocha e.g. describe
import { UrlPath } from '../../src/common/httpPostJson';
import { sleepMsec } from '../../src/common/util';
import { Address, JSONObject, NodeId } from '../../src/interfaces/core';
import { daemonVersion, protocolVersion } from '../../src/protocolVersion';
import BootstrapService from '../../src/services/BootstrapService';
import { ApiProbeResponse } from '../../src/services/PublicApiServer';
import { DurationMsec, durationMsec } from '../../src/udp/UdpCongestionManager';
import { createRandomNodeId, MockKacheryP2PNode } from '../mock/MockKacheryP2PNode';

const mockHttpPostJson = (nodeId: NodeId, isBootstrapNode: boolean) => (async (address: Address, path: UrlPath, data: JSONObject, opts: {timeoutMsec: DurationMsec}) => {
    if (path.toString() === '/probe') {
        const response: ApiProbeResponse = {
            success: true,
            protocolVersion: protocolVersion(),
            daemonVersion: daemonVersion(),
            nodeId: nodeId,
            isBootstrapNode: isBootstrapNode,
            webSocketAddress: null,
            publicUdpSocketAddress: null
        }
        return response as any as JSONObject
    }
    else {
        throw Error('Unexpected path in mockHttpPostJson')
    }
})

 // need to explicitly use mocha prefix once or the dependency gets wrongly cleaned up
 mocha.describe('Bootstrap service', () => {
    describe('Test probe', () => {
        it('Probe bootstrap nodes', (done) => {
            (async () => {
                const node = new MockKacheryP2PNode()
                const bootstrapService = new BootstrapService(node, {probeIntervalMsec: durationMsec(2), httpPostJson: mockHttpPostJson(createRandomNodeId(), true)})
                // at least one bootstrap node
                expect(node.remoteNodeManager().getBootstrapRemoteNodes()).is.empty
                // wait a bit for connecting to bootstrap node
                await sleepMsec(5)
                // now we should have a bootstrap node
                expect(node.remoteNodeManager().getBootstrapRemoteNodes().length).is.greaterThan(0)
                // stop the service
                bootstrapService.stop()
                done()
            })()
        })
    })
 })