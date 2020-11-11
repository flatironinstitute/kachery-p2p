import { action } from "../common/action";
import { TIMEOUTS } from "../common/constants";
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
                        var selectedNode = selectNode(nodes, channelName)
                        /////////////////////////////////////////////////////////////////////////
                        await action('discoverFromRandomNode', {context: 'DiscoverService', remoteNodeId: selectedNode.remoteNodeId(), channelName}, async () => {
                            await this._getChannelInfoFromNode(selectedNode.remoteNodeId(), channelName)
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

const selectNode = (nodes: RemoteNode[], channelName: ChannelName) => {
    /* istanbul ignore next */
    if (nodes.length === 0) throw Error('Unexpected')
    let ret = nodes[0]
    let age = ret.ageOfChannelNodeInfo(channelName)
    /* istanbul ignore next */
    if (age === null) throw Error('Unexpected')
    for (let node of nodes) {
        const ageMsec = node.ageOfChannelNodeInfo(channelName)
        if ((ageMsec !== null) && (ageMsec < age)) {
            age = ageMsec
            ret = node
        }
    }
    return ret
}