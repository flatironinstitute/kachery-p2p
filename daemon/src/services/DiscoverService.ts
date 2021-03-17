import { action } from "../common/action";
import { TIMEOUTS } from "../common/constants";
import GarbageMap from "../common/GarbageMap";
import { sleepMsec } from "../common/util";
import { HttpPostJsonError } from "../external/real/httpRequests";
import { ChannelConfigUrl, DurationMsec, durationMsecToNumber, elapsedSince, NodeId, nowTimestamp, scaledDurationMsec, Timestamp, zeroTimestamp } from "../interfaces/core";
import { GetChannelInfoRequestData, isGetChannelInfoResponseData } from "../interfaces/NodeToNodeRequest";
import KacheryP2PNode from "../KacheryP2PNode";
import RemoteNode from "../RemoteNode";
import RemoteNodeManager from "../RemoteNodeManager";

export default class DiscoverService {
    #node: KacheryP2PNode
    #remoteNodeManager: RemoteNodeManager
    #halted = false
    #discoverHistoryTimestamps = new GarbageMap<string, Timestamp>(scaledDurationMsec(30 * 60 * 1000))
    constructor(node: KacheryP2PNode, private opts: {discoverBootstrapIntervalMsec: DurationMsec, discoverIndividualNodeIntervalMsec: DurationMsec}) {
        this.#node = node
        this.#remoteNodeManager = node.remoteNodeManager()

        this.#remoteNodeManager.onBootstrapNodeAdded((bootstrapNodeId) => {
            if (this.#halted) return
            const channelConfigUrls = this.#node.joinedChannelConfigUrls()
            for (let channelConfigUrl of channelConfigUrls) {
                /////////////////////////////////////////////////////////////////////////
                action('discoverFromNewBootstrap', {context: 'DiscoverService', bootstrapNodeId, channelConfigUrl}, async () => {
                    await this._getChannelInfoFromNode(bootstrapNodeId, channelConfigUrl)
                }, null)
                /////////////////////////////////////////////////////////////////////////
            }
        })

        this._start();
    }
    stop() {
        this.#halted = true
    }
    async _getChannelInfoFromNode(remoteNodeId: NodeId, channelConfigUrl: ChannelConfigUrl) {
        let numPasses = 0
        while (!this.#remoteNodeManager.canSendRequestToNode(remoteNodeId, 'default')) {
            numPasses ++
            if (numPasses > 3) return
            await sleepMsec(scaledDurationMsec(1500))
        }
        const requestData: GetChannelInfoRequestData = {
            requestType: 'getChannelInfo',
            channelConfigUrl
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
            throw Error(`Unexpected GetChannelInfoResponseData from node: ${remoteNodeId.slice(0, 6)}`);
        }
        const { channelInfo } = responseData;
        for (let channelNodeInfo of channelInfo.nodes) {
            if (channelNodeInfo.body.nodeId !== this.#node.nodeId()) {
                await this.#remoteNodeManager.setChannelNodeInfo(channelNodeInfo)
            }
        }
    }
    async _start() {
        const timestampStarted = nowTimestamp()
        // Get channel info from other nodes in our channels
        let lastBootstrapDiscoverTimestamp: Timestamp = zeroTimestamp()
        let lastIndividualNodeDiscoverTimestamp: Timestamp = zeroTimestamp()
        while (true) {
            if (this.#halted) return
            // periodically get channel info from bootstrap nodes
            const startingUp = elapsedSince(timestampStarted) < durationMsecToNumber(scaledDurationMsec(15000))
            const discoverBootstrapIntervalMsec = startingUp ? scaledDurationMsec(2000) : this.opts.discoverBootstrapIntervalMsec
            const discoverIndividualNodeIntervalMsec = startingUp ? scaledDurationMsec(500) : this.opts.discoverIndividualNodeIntervalMsec
            const elapsedSinceLastBootstrapDiscover = elapsedSince(lastBootstrapDiscoverTimestamp);
            if (elapsedSinceLastBootstrapDiscover > durationMsecToNumber(discoverBootstrapIntervalMsec)) {
                const bootstrapNodes: RemoteNode[] = this.#remoteNodeManager.getBootstrapRemoteNodes({includeOffline: false});
                const channelConfigUrls = this.#node.joinedChannelConfigUrls()
                for (let bootstrapNode of bootstrapNodes) {
                    for (let channelConfigUrl of channelConfigUrls) {
                        /////////////////////////////////////////////////////////////////////////
                        await action('discoverFromBootstrapNode', {context: 'DiscoverService', bootstrapNodeId: bootstrapNode.remoteNodeId(), channelConfigUrl}, async () => {
                            await this._getChannelInfoFromNode(bootstrapNode.remoteNodeId(), channelConfigUrl)
                        }, async (err: Error) => {
                            console.warn(`Problem discovering from bootstrap node ${bootstrapNode.remoteNodeId().slice(0, 6)} (${err.message})`)
                        });
                        /////////////////////////////////////////////////////////////////////////
                    }
                }
                lastBootstrapDiscoverTimestamp = nowTimestamp();
            }
            
            const elapsedSinceLastIndividualNodeDiscover = elapsedSince(lastIndividualNodeDiscoverTimestamp)
            if (elapsedSinceLastIndividualNodeDiscover > durationMsecToNumber(discoverIndividualNodeIntervalMsec)) {
                // for each channel, choose node with longest elapsed time of their channel node info and get the channel info from that node
                const channelConfigUrls = this.#node.joinedChannelConfigUrls()
                for (let channelConfigUrl of channelConfigUrls) {
                    let nodes = this.#remoteNodeManager.getRemoteNodesInChannel(channelConfigUrl, {includeOffline: false})
                    if (nodes.length > 0) {
                        var individualNode = selectNode(nodes, channelConfigUrl, this.#discoverHistoryTimestamps)
                        this.#discoverHistoryTimestamps.set(getCode(individualNode.remoteNodeId(), channelConfigUrl), nowTimestamp())

                        /////////////////////////////////////////////////////////////////////////
                        await action('discoverFromIndividualNode', {context: 'DiscoverService', remoteNodeId: individualNode.remoteNodeId(), channelConfigUrl}, async () => {
                            await this._getChannelInfoFromNode(individualNode.remoteNodeId(), channelConfigUrl)
                        }, async (err: Error) => {
                            console.warn(`Problem discovering from individual node ${individualNode.remoteNodeId().slice(0, 6)} (${err.message})`)
                        });
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
    if (array.length === 0) throw Error('Unexpected in argMax')
    return array.map((x, i) => [x, i]).reduce((r, a) => (a[0] > r[0] ? a : r))[1];
}

const selectNode = (nodes: RemoteNode[], channelConfigUrl: ChannelConfigUrl, historyTimestamps: GarbageMap<string, Timestamp>): RemoteNode => {
    const n = nodes[0]
    if (!n) throw Error('Unexpected in selectNode')
    const timestamps: Timestamp[] = nodes.map(n => (historyTimestamps.getWithDefault(getCode(n.remoteNodeId(), channelConfigUrl), zeroTimestamp())))
    const elapsedTimes = timestamps.map(ts => (elapsedSince(ts)))
    const ind = argMax(elapsedTimes)
    return nodes[ind]
}

const getCode = (nodeId: NodeId, channelConfigUrl: ChannelConfigUrl) => {
    return nodeId.toString() + ':' + channelConfigUrl.toString()
}