import { action } from "../common/action";
import { sleepMsec } from "../common/util";
import { ChannelName, ChannelNodeInfo, elapsedSince, NodeId, nowTimestamp, Timestamp, zeroTimestamp } from "../interfaces/core";
import { GetChannelInfoRequestData, isGetChannelInfoResponseData, NodeToNodeRequestData, NodeToNodeResponseData } from "../interfaces/NodeToNodeRequest";
import { SendRequestMethod } from "../RemoteNode";
import { DurationMsec, durationMsec, durationMsecToNumber } from "../udp/UdpCongestionManager";

interface RemoteNodeManagerInterface {
    sendRequestToNode: (remoteNodeId: NodeId, requestData: NodeToNodeRequestData, opts: {timeoutMsec: DurationMsec, method: SendRequestMethod}) => Promise<NodeToNodeResponseData>,
    setChannelNodeInfo: (channelNodeInfo: ChannelNodeInfo) => void
    getBootstrapRemoteNodes: () => RemoteNodeInterface[]
    getRemoteNodesInChannel: (channelName: ChannelName) => RemoteNodeInterface[]
}

interface RemoteNodeInterface {
    remoteNodeId: () => NodeId
}

interface KacheryP2PNodeInterface {
    remoteNodeManager: () => RemoteNodeManagerInterface,
    channelNames: () => ChannelName[]
}

export default class DiscoverService {
    #node: KacheryP2PNodeInterface
    #remoteNodeManager: RemoteNodeManagerInterface
    constructor(node: KacheryP2PNodeInterface, private opts: {discoverBootstrapIntervalMsec: DurationMsec, discoverRandomNodeIntervalMsec: DurationMsec} = {discoverBootstrapIntervalMsec: durationMsec(30000), discoverRandomNodeIntervalMsec: durationMsec(2200)}) {
        this.#node = node
        this.#remoteNodeManager = node.remoteNodeManager()
        this._start();
    }
    async _getChannelInfoFromNode(remoteNodeId: NodeId, channelName: ChannelName) {
        const requestData: GetChannelInfoRequestData = {
            requestType: 'getChannelInfo',
            channelName
        }
        const responseData = await this.#remoteNodeManager.sendRequestToNode(remoteNodeId, requestData, {timeoutMsec: durationMsec(3000), method: 'default'})
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
            if (elapsedSinceLastBootstrapDiscover > durationMsecToNumber(this.opts.discoverBootstrapIntervalMsec)) {
                const bootstrapNodes: RemoteNodeInterface[] = this.#remoteNodeManager.getBootstrapRemoteNodes();
                const channelNames = this.#node.channelNames();
                for (let bootstrapNode of bootstrapNodes) {
                    for (let channelName of channelNames) {
                        /////////////////////////////////////////////////////////////////////////
                        action('getChannelInfoFromBootstrapNode', {context: 'FindChannelNodesService', bootstrapNodeId: bootstrapNode.remoteNodeId(), channelName}, async () => {
                            await this._getChannelInfoFromNode(bootstrapNode.remoteNodeId(), channelName);
                        }, null);
                        /////////////////////////////////////////////////////////////////////////
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
                    /////////////////////////////////////////////////////////////////////////
                    action('getChannelInfoFromRandomNode', {context: 'FindChannelNodesService', remoteNodeId: randomNode.remoteNodeId(), channelName}, async () => {
                        await this._getChannelInfoFromNode(randomNode.remoteNodeId(), channelName);
                    }, null);
                    /////////////////////////////////////////////////////////////////////////
                }
            }
            await sleepMsec(durationMsecToNumber(this.opts.discoverRandomNodeIntervalMsec))
        }
    }
}

const randomIndex = (n: number): number => {
    return Math.floor(Math.random() * n);
}