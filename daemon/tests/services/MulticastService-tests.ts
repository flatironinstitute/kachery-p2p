import * as mocha from 'mocha'; // import types for mocha e.g. describe
import { JSONObject } from '../../src/interfaces/core';
import MulticastService from '../../src/services/MulticastService';
import { durationMsec } from '../../src/udp/UdpCongestionManager';
import { mockChannelName, MockKacheryP2PNode } from '../mock/MockKacheryP2PNode';

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

 // need to explicitly use mocha prefix once or the dependency gets wrongly cleaned up
 mocha.describe('Multicast service', () => {
    describe('Test multicast', () => {
        it('Run the multicast service', (done) => {
            (async () => {
                const node = new MockKacheryP2PNode()
                node.remoteNodeManager().mock_addNewNodeInChannels([mockChannelName])
                node.remoteNodeManager().mock_addBootstrapNode()
                const multicastService = new MulticastService(node, {intervalMsec: durationMsec(2), dgramCreateSocket: mockDgramCreateSocket})
                // todo: test the functionality
                multicastService.stop()
                done()
            })()
        })
    })
 })