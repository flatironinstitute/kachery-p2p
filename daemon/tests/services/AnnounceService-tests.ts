import { expect } from 'chai';
import * as mocha from 'mocha'; // import types for mocha e.g. describe
import { sleepMsec } from '../../src/common/util';
import AnnounceService from '../../src/services/AnnounceService';
import { durationMsec } from '../../src/udp/UdpCongestionManager';
import { mockChannelName, MockKacheryP2PNode } from '../mock/MockKacheryP2PNode';

 // need to explicitly use mocha prefix once or the dependency gets wrongly cleaned up
 mocha.describe('AnnounceService', () => {
    describe('Test announce', () => {
        it('Announce to bootstrap and nodes in channel', (done) => {
            (async () => {
                const node = new MockKacheryP2PNode()
                node.remoteNodeManager().mock_addNewNodeInChannels([mockChannelName])
                node.remoteNodeManager().mock_addBootstrapNode()
                const announceService = new AnnounceService(node, {announceBootstrapIntervalMsec: durationMsec(3), announceToRandomNodeIntervalMsec: durationMsec(2)})
                // at least one bootstrap node
                expect(node.remoteNodeManager().getBootstrapRemoteNodes().length).is.greaterThan(0)
                // at least one node in our channel
                expect(node.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).is.greaterThan(0)
                node.remoteNodeManager().getBootstrapRemoteNodes().forEach(n => {
                    // have not yet announced
                    expect(n.mock_announcedChannelNodeInfo()).is.null
                })
                node.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).forEach(n => {
                    // have not yet announced
                    expect(n.mock_announcedChannelNodeInfo()).is.null
                })
                // wait a bit for announce to take place
                await sleepMsec(10)
                // add a new node (just get announced to right away)
                node.remoteNodeManager().mock_addNewNodeInChannels([mockChannelName])
                // at least 2 nodes in channel now
                expect(node.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).is.greaterThan(1)
                node.remoteNodeManager().getBootstrapRemoteNodes().forEach(n => {
                    // we have announced to bootstrap node
                    expect(n.mock_announcedChannelNodeInfo()).is.not.null
                })
                node.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).forEach(n => {
                    // we have announced to nodes in our channel
                    expect(n.mock_announcedChannelNodeInfo()).is.not.null
                })
                // stop the service
                announceService.stop()
                done()
            })()
        })
    })
 })