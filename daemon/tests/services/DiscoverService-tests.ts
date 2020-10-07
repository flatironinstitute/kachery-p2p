import { expect } from 'chai';
import * as mocha from 'mocha'; // import types for mocha e.g. describe
import DiscoverService from '../../src/services/DiscoverService';
import { durationMsec } from '../../src/udp/UdpCongestionManager';
import { mockChannelName, MockKacheryP2PNode } from '../mock/MockKacheryP2PNode';

 // need to explicitly use mocha prefix once or the dependency gets wrongly cleaned up
 mocha.describe('Discover service', () => {
    describe('Test discovery', () => {
        it('Get channel info from bootstrap node and nodes in channel', (done) => {
            (async () => {
                const node = new MockKacheryP2PNode()
                node.remoteNodeManager().mock_addNewNodeInChannels([mockChannelName])
                node.remoteNodeManager().mock_addBootstrapNode()
                const discoverService = new DiscoverService(node, {discoverBootstrapIntervalMsec: durationMsec(3), discoverRandomNodeIntervalMsec: durationMsec(2)})
                // at least one bootstrap node
                expect(node.remoteNodeManager().getBootstrapRemoteNodes().length).is.greaterThan(0)
                // at least one node in our channel
                expect(node.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).is.greaterThan(0)
                // todo: test the functionality of the service here
                // stop the service
                discoverService.stop()
                done()
            })()
        })
    })
 })