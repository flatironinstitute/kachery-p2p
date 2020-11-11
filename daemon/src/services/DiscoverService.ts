import { action } from "../common/action";
import { TIMEOUTS } from "../common/constants";
import GarbageMap from "../common/GarbageMap";
import { sleepMsec } from "../common/util";
import { HttpPostJsonError } from "../external/real/httpRequests";
import { ChannelName, DurationMsec, durationMsecToNumber, elapsedSince, NodeId, nowTimestamp, scaledDurationMsec, Timestamp, zeroTimestamp } from "../interfaces/core";
import { GetChannelInfoRequestData, isGetChannelInfoResponseData } from "../interfaces/NodeToNodeRequest";
import KacheryP2PNode from "../KacheryP2PNode";
import RemoteNode from "../RemoteNode";
import RemoteNodeManager from "../RemoteNodeManager";

export default class DiscoverService {
    #node: KacheryP2PNode
    #remoteNodeManager: RemoteNodeManager
    #halted = false
    #discoverHistoryTimestamps = new GarbageMap<NodeId, Timestamp>(scaledDurationMsec(30 * 60 * 1000))
    constructor(node: KacheryP2PNode, private opts: {discoverBootstrapIntervalMsec: DurationMsec, discoverIndividualNodeIntervalMsec: DurationMsec}) {
        this.#node = node
        this.#remoteNodeManager = node.remoteNodeManager()

        this.#remoteNodeManager.onBootstrapNodeAdded((bootstrapNodeId) => {
            if (this.#halted) return
            const channelNames = this.#node.channelNames()
            for (let channelName of channelNames) {
                /////////////////////////////////////////////////////////////////////////
                action('discoverFromNewBootstrap', {context: 'DiscoverService', bootstrapNodeId, channelName}, async () => {
                    await this._getChannelInfoFromNode(bootstrapNodeId, channelName)
                }, null)
                /////////////////////////////////////////////////////////////////////////
            }
        })

        this._start();
    }
    stop() {
        this.#halted = true
    }
    async _getChannelInfoFromNode(remoteNodeId: NodeId, channelName: ChannelName) {
        let numPasses = 0
        while (!this.#remoteNodeManager.canSendRequestToNode(remoteNodeId, 'default')) {
            numPasses ++
            if (numPasses > 3) return
            await sleepMsec(scaledDurationMsec(1500))
        }
        const requestData: GetChannelInfoRequestData = {
            requestType: 'getChannelInfo',
            channelName
        }
        let responseData
        try {
            responseData = await this.#remoteNodeManager.sendRequestToNode(remoteNodeId, requestData, {timeoutMsec: TIMEOUTS.defaultRequest, method: 'default'})
        }
        catch(err) {
            if (err instanceof HttpPostJsonError) {
                // the node is probably not connected
                return
            }
            else {
                throw err
            }
        }
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
        let lastBootstrapDiscoverTimestamp: Timestamp = zeroTimestamp()
        let lastIndividualNodeDiscoverTimestamp: Timestamp = zeroTimestamp()
        while (true) {
            if (this.#halted) return
            // periodically get channel info from bootstrap nodes
            const elapsedSinceLastBootstrapDiscover = elapsedSince(lastBootstrapDiscoverTimestamp);
            if (elapsedSinceLastBootstrapDiscover > durationMsecToNumber(this.opts.discoverBootstrapIntervalMsec)) {
                const bootstrapNodes: RemoteNode[] = this.#remoteNodeManager.getBootstrapRemoteNodes();
                const channelNames = this.#node.channelNames();
                for (let bootstrapNode of bootstrapNodes) {
                    for (let channelName of channelNames) {
                        /////////////////////////////////////////////////////////////////////////
                        await action('discoverFromBootstrapNode', {context: 'DiscoverService', bootstrapNodeId: bootstrapNode.remoteNodeId(), channelName}, async () => {
                            await this._getChannelInfoFromNode(bootstrapNode.remoteNodeId(), channelName)
                        }, null);
                        /////////////////////////////////////////////////////////////////////////
                    }
                }
                lastBootstrapDiscoverTimestamp = nowTimestamp();
            }
            
            const elapsedSinceLastIndividualNodeDiscover = elapsedSince(lastIndividualNodeDiscoverTimestamp)
            if (elapsedSinceLastIndividualNodeDiscover > durationMsecToNumber(this.opts.discoverIndividualNodeIntervalMsec)) {
                // for each channel, choose node with longest elapsed time of their channel node info and get the channel info from that node
                const channelNames = this.#node.channelNames();
                for (let channelName of channelNames) {
                    let nodes = this.#remoteNodeManager.getRemoteNodesInChannel(channelName).filter(rn => (rn.isOnline()))
                    if (nodes.length > 0) {
                        var individualNode = selectNode(nodes, this.#discoverHistoryTimestamps)
                        this.#discoverHistoryTimestamps.set(individualNode.remoteNodeId(), nowTimestamp())

                        /////////////////////////////////////////////////////////////////////////
                        await action('discoverFromIndividualNode', {context: 'DiscoverService', remoteNodeId: individualNode.remoteNodeId(), channelName}, async () => {
                            await this._getChannelInfoFromNode(individualNode.remoteNodeId(), channelName)
                        }, null);
                        /////////////////////////////////////////////////////////////////////////
                    }
                }
                lastIndividualNodeDiscoverTimestamp = nowTimestamp()
            }

            await sleepMsec(scaledDurationMsec(500), () => {return !this.#halted})
        }
    }
}

// thanks: https://gist.github.com/engelen/fbce4476c9e68c52ff7e5c2da5c24a28
function argMax(array: number[]) {
    if (array.length === 0) throw Error('Unexpected')
    return array.map((x, i) => [x, i]).reduce((r, a) => (a[0] > r[0] ? a : r))[1];
}

const selectNode = (nodes: RemoteNode[], historyTimestamps: GarbageMap<NodeId, Timestamp>): RemoteNode => {
    const n = nodes[0]
    if (!n) throw Error('Unexpected')
    const timestamps: Timestamp[] = nodes.map(n => (historyTimestamps.getWithDefault(n.remoteNodeId(), zeroTimestamp())))
    const elapsedTimes = timestamps.map(ts => (elapsedSince(ts)))
    const ind = argMax(elapsedTimes)
    return nodes[ind]
}