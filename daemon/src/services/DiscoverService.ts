import { action } from "../action";
import { sleepMsec } from "../common/util";
import { ChannelName, elapsedSince, NodeId, nowTimestamp, Timestamp, zeroTimestamp } from "../interfaces/core";
import { GetChannelInfoRequestData, isGetChannelInfoResponseData } from "../interfaces/NodeToNodeRequest";
import KacheryP2PNode from "../KacheryP2PNode";
import RemoteNode from "../RemoteNode";
import RemoteNodeManager from "../RemoteNodeManager";

export default class DiscoverService {
    #node: KacheryP2PNode
    #remoteNodeManager: RemoteNodeManager
    constructor(node: KacheryP2PNode) {
        this.#node = node
        this.#remoteNodeManager = node.remoteNodeManager()
        this._start();
    }
    async _getChannelInfoFromNode(remoteNodeId: NodeId, channelName: ChannelName) {
        const requestData: GetChannelInfoRequestData = {
            requestType: 'getChannelInfo',
            channelName
        }
        const responseData = await this.#remoteNodeManager.sendRequestToNode(remoteNodeId, requestData, {timeoutMsec: 3000})
        if (!isGetChannelInfoResponseData(responseData)) {
            throw Error('Unexpected.');
        }
        const { channelInfo } = responseData;
        channelInfo.nodes.forEach(channelNodeInfo => {
            this.#remoteNodeManager.setChannelNodeInfo(channelNodeInfo)
        })
    }
    async _start() {
        // Get channel info from other nodes in our channels
        let lastBootstrapDiscoverTimestamp: Timestamp = zeroTimestamp();
        while (true) {
            // periodically get channel info from bootstrap nodes
            const elapsedSinceLastBootstrapDiscover = elapsedSince(lastBootstrapDiscoverTimestamp);
            if (elapsedSinceLastBootstrapDiscover > 30000) {
                const bootstrapNodes: RemoteNode[] = this.#remoteNodeManager.getBootstrapRemoteNodes();
                const channelNames = this.#node.channelNames();
                for (let bootstrapNode of bootstrapNodes) {
                    for (let channelName of channelNames) {
                        action('getChannelInfoFromBootstrapNode', {context: 'FindChannelNodesService', bootstrapNodeId: bootstrapNode.remoteNodeId(), channelName}, async () => {
                            await this._getChannelInfoFromNode(bootstrapNode.remoteNodeId(), channelName);
                        }, null);
                    }
                }
                lastBootstrapDiscoverTimestamp = nowTimestamp();
            }
            
            // for each channel, choose a random node and get the channel info from that node
            const channelNames = this.#node.channelNames();
            for (let channelName of channelNames) {
                let nodes = this.#remoteNodeManager.getRemoteNodesInChannel(channelName);
                if (nodes.length > 0) {
                    var randomNode = nodes[randomIndex(nodes.length)];
                    action('getChannelInfoFromRandomNode', {context: 'FindChannelNodesService', remoteNodeId: randomNode.remoteNodeId(), channelName}, async () => {
                        await this._getChannelInfoFromNode(randomNode.remoteNodeId(), channelName);
                    }, null);
                }
            }
            await sleepMsec(2000);
        }
    }
}

const randomIndex = (n: number): number => {
    return Math.floor(Math.random() * n);
}