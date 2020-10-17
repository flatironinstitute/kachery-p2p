import { action } from "../common/action";
import { sleepMsec } from "../common/util";
import { ChannelName, ChannelNodeInfo, durationMsec, DurationMsec, durationMsecToNumber, elapsedSince, NodeId, nowTimestamp, Timestamp, zeroTimestamp } from "../interfaces/core";
import { GetChannelInfoRequestData, isGetChannelInfoResponseData, NodeToNodeRequestData, NodeToNodeResponseData } from "../interfaces/NodeToNodeRequest";
import { SendRequestMethod } from "../RemoteNode";

interface RemoteNodeManagerInterface {
    sendRequestToNode: (remoteNodeId: NodeId, requestData: NodeToNodeRequestData, opts: {timeoutMsec: DurationMsec, method: SendRequestMethod}) => Promise<NodeToNodeResponseData>,
    setChannelNodeInfo: (channelNodeInfo: ChannelNodeInfo) => void
    getBootstrapRemoteNodes: () => RemoteNodeInterface[]
    getRemoteNodesInChannel: (channelName: ChannelName) => RemoteNodeInterface[]
    canSendRequestToNode: (remoteNodeId: NodeId, method: SendRequestMethod) => boolean
}

interface RemoteNodeInterface {
    remoteNodeId: () => NodeId
}

interface KacheryP2PNodeInterface {
    nodeId: () => NodeId
    remoteNodeManager: () => RemoteNodeManagerInterface,
    channelNames: () => ChannelName[]
}

export default class DiscoverService {
    #node: KacheryP2PNodeInterface
    #remoteNodeManager: RemoteNodeManagerInterface
    #halted = false
    constructor(node: KacheryP2PNodeInterface, private opts: {discoverBootstrapIntervalMsec: DurationMsec, discoverRandomNodeIntervalMsec: DurationMsec}) {
        this.#node = node
        this.#remoteNodeManager = node.remoteNodeManager()
        this._start();
    }
    stop() {
        this.#halted = true
    }
    async _getChannelInfoFromNode(remoteNodeId: NodeId, channelName: ChannelName) {
        if (!this.#remoteNodeManager.canSendRequestToNode(remoteNodeId, 'default')) {
            return
        }
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
            if (channelNodeInfo.body.nodeId !== this.#node.nodeId()) {
                this.#remoteNodeManager.setChannelNodeInfo(channelNodeInfo)
            }
        })
    }
    async _start() {
        // Get channel info from other nodes in our channels
        let lastBootstrapDiscoverTimestamp: Timestamp = zeroTimestamp();
        while (true) {
            if (this.#halted) return
            // periodically get channel info from bootstrap nodes
            const elapsedSinceLastBootstrapDiscover = elapsedSince(lastBootstrapDiscoverTimestamp);
            if (elapsedSinceLastBootstrapDiscover > durationMsecToNumber(this.opts.discoverBootstrapIntervalMsec)) {
                const bootstrapNodes: RemoteNodeInterface[] = this.#remoteNodeManager.getBootstrapRemoteNodes();
                const channelNames = this.#node.channelNames();
                for (let bootstrapNode of bootstrapNodes) {
                    for (let channelName of channelNames) {
                        /////////////////////////////////////////////////////////////////////////
                        await action('getChannelInfoFromBootstrapNode', {context: 'FindChannelNodesService', bootstrapNodeId: bootstrapNode.remoteNodeId(), channelName}, async () => {
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
                    await action('getChannelInfoFromRandomNode', {context: 'FindChannelNodesService', remoteNodeId: randomNode.remoteNodeId(), channelName}, async () => {
                        await this._getChannelInfoFromNode(randomNode.remoteNodeId(), channelName);
                    }, null);
                    /////////////////////////////////////////////////////////////////////////
                }
            }
            await sleepMsec(durationMsecToNumber(this.opts.discoverRandomNodeIntervalMsec), () => {return !this.#halted})
        }
    }
}

const randomIndex = (n: number): number => {
    return Math.floor(Math.random() * n);
}