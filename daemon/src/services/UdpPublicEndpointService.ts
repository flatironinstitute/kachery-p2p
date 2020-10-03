import { action } from "../common/action";
import { sleepMsec } from "../common/util";
import { NodeId } from "../interfaces/core";
import { ProbeRequestData } from "../interfaces/NodeToNodeRequest";
import KacheryP2PNode from "../KacheryP2PNode";
import RemoteNode from "../RemoteNode";
import RemoteNodeManager from "../RemoteNodeManager";

export default class UdpPublicEndpointService {
    #node: KacheryP2PNode
    #remoteNodeManager: RemoteNodeManager
    constructor(node: KacheryP2PNode) {
        this.#node = node
        this.#remoteNodeManager = node.remoteNodeManager()
        // determine udp public endpoint when bootstrap node has been added
        this.#remoteNodeManager.onBootstrapNodeAdded((bootstrapNodeId: NodeId) => {

            /////////////////////////////////////////////////////////////////////////
            action('getSelfPublicEndpointFromBootstrapNode', {context: 'UdpPublicEndpointService', bootstrapNodeId}, async () => {
                await this._getSelfPublicEndpointFromBootstrapNode(bootstrapNodeId)
            }, null);
            /////////////////////////////////////////////////////////////////////////

        })
        this._start();
    }
    async _getSelfPublicEndpointFromBootstrapNode(bootstrapNodeId: NodeId) {
        const bootstrapNode = this.#remoteNodeManager.getRemoteNode(bootstrapNodeId)
        if (bootstrapNode === null) {
            return
        }
        if (!bootstrapNode.isBootstrap()) {
            return
        }
        const udpAddress = bootstrapNode.bootstrapUdpSocketAddress()
        if (udpAddress === null) {
            return
        }
        if (!this.#node.publicUdpSocketServer()) {
            // we don't have a udp socket running
            return
        }
        const probeRequestData: ProbeRequestData = {
            requestType: 'probe'
        }
        // Many any request, and force the method to be udp. We will then implicitly find out our public endpoint when the udp response comes back
        const response = bootstrapNode.sendRequest(probeRequestData, {timeoutMsec: 5000, method: 'udp'})
        if (!this.#node.publicUdpSocketAddress()) {
            throw Error('Still no public udp address. This is unexpected.')
        }
    }
    async _start() {
        while (true) {
            const bootstrapNodes: RemoteNode[] = this.#remoteNodeManager.getBootstrapRemoteNodes();
            for (let bootstrapNode of bootstrapNodes) {
                const bootstrapNodeId = bootstrapNode.remoteNodeId()
                /////////////////////////////////////////////////////////////////////////
                action('getSelfPublicEndpointFromBootstrapNode', {context: 'UdpPublicEndpointService', bootstrapNodeId}, async () => {
                    await this._getSelfPublicEndpointFromBootstrapNode(bootstrapNodeId)
                }, null);
                /////////////////////////////////////////////////////////////////////////
            }
            await sleepMsec(40000);
        }
    }
}
