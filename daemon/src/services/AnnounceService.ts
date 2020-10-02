import { action } from "../common/action";
import { sleepMsec } from "../common/util";
import { ChannelName, elapsedSince, NodeId, nowTimestamp, Timestamp, zeroTimestamp } from "../interfaces/core";
import { AnnounceRequestData, isAnnounceResponseData } from "../interfaces/NodeToNodeRequest";
import KacheryP2PNode from "../KacheryP2PNode";
import RemoteNode from "../RemoteNode";
import RemoteNodeManager from "../RemoteNodeManager";

export default class AnnounceService {
    #node: KacheryP2PNode
    #remoteNodeManager: RemoteNodeManager
    constructor(node: KacheryP2PNode) {
        this.#node = node
        this.#remoteNodeManager = node.remoteNodeManager()
        // announce self when a new node-channel has been added
        this.#remoteNodeManager.onNodeChannelAdded((remoteNodeId: NodeId, channelName: ChannelName) => {

            /////////////////////////////////////////////////////////////////////////
            action('announceToNewNode', {context: 'AnnounceService', remoteNodeId, channelName}, async () => {
                await this._announceToNode(remoteNodeId, channelName)
            }, null);
            /////////////////////////////////////////////////////////////////////////

        })
        this._start();
    }
    async _announceToNode(remoteNodeId: NodeId, channelName: ChannelName) {
        const requestData: AnnounceRequestData = {
            requestType: 'announce',
            channelNodeInfo: this.#node.getChannelNodeInfo(channelName)
        }
        const responseData = await this.#remoteNodeManager.sendRequestToNode(remoteNodeId, requestData, {timeoutMsec: 2000})
        if (!isAnnounceResponseData(responseData)) {
            throw Error('Unexpected.');
        }
        if (!responseData.success) {
            console.warn(`Response error for announce: ${responseData.errorMessage}`);
        }
    }
    async _start() {
        // Announce self other nodes in our channels and to bootstrap nodes
        let lastBootstrapAnnounceTimestamp: Timestamp = zeroTimestamp();
        while (true) {
            // periodically announce to bootstrap nodes
            const elapsedSinceLastBootstrapAnnounce = elapsedSince(lastBootstrapAnnounceTimestamp);
            if (elapsedSinceLastBootstrapAnnounce > 21000) {
                const bootstrapNodes: RemoteNode[] = this.#remoteNodeManager.getBootstrapRemoteNodes();
                const channelNames = this.#node.channelNames();
                for (let bootstrapNode of bootstrapNodes) {
                    for (let channelName of channelNames) {

                        /////////////////////////////////////////////////////////////////////////
                        action('announceToNode', {context: 'AnnounceService', bootstrapNodeId: bootstrapNode.remoteNodeId(), channelName}, async () => {
                            await this._announceToNode(bootstrapNode.remoteNodeId(), channelName);
                        }, null);
                        /////////////////////////////////////////////////////////////////////////

                    }
                }
                lastBootstrapAnnounceTimestamp = nowTimestamp();
            }
            
            // for each channel, choose a random node and announce to that node
            const channelNames = this.#node.channelNames();
            for (let channelName of channelNames) {
                let nodes = this.#remoteNodeManager.getRemoteNodesInChannel(channelName);
                if (nodes.length > 0) {
                    var randomNode = nodes[randomIndex(nodes.length)];

                    /////////////////////////////////////////////////////////////////////////
                    action('announceToRandomNode', {context: 'AnnounceService', remoteNodeId: randomNode.remoteNodeId(), channelName}, async () => {
                        await this._announceToNode(randomNode.remoteNodeId(), channelName);
                    }, null);
                    /////////////////////////////////////////////////////////////////////////

                }
            }
            await sleepMsec(2000);
        }
    }
}

const randomIndex = (n: number): number => {
    return Math.floor(Math.random() * n);
}