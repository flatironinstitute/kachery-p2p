import { action } from "../common/action"
import { TIMEOUTS } from "../common/constants"
import GarbageMap from "../common/GarbageMap"
import { RequestTimeoutError, sleepMsec, sleepMsecNum } from "../common/util"
import { HttpPostJsonError } from "../external/real/httpRequests"
import { ChannelConfigUrl, DurationMsec, durationMsecToNumber, elapsedSince, NodeId, nowTimestamp, scaledDurationMsec, Timestamp, zeroTimestamp } from "../interfaces/core"
import { AnnounceRequestData, isAnnounceResponseData } from "../interfaces/NodeToNodeRequest"
import KacheryP2PNode from "../KacheryP2PNode"
import RemoteNode, { SendRequestMethod } from "../RemoteNode"
import RemoteNodeManager from "../RemoteNodeManager"

export default class AnnounceService {
    #node: KacheryP2PNode
    #remoteNodeManager: RemoteNodeManager
    #halted = false
    #announceHistoryTimestamps = new GarbageMap<string, Timestamp>(scaledDurationMsec(30 * 60 * 1000))
    constructor(node: KacheryP2PNode, private opts: {announceBootstrapIntervalMsec: DurationMsec, announceToIndividualNodeIntervalMsec: DurationMsec}) {
        this.#node = node
        this.#remoteNodeManager = node.remoteNodeManager()
        // announce self when a new node-channel has been added
        this.#remoteNodeManager.onNodeChannelAdded(async (remoteNodeId: NodeId, channelConfigUrl: ChannelConfigUrl) => {
            if (this.#halted) return
            // check if we can send message to node, if not, delay a bit
            let numPasses = 0
            while (!this.#remoteNodeManager.canSendRequestToNode(remoteNodeId, 'default')) {
                if (numPasses > 3) return
                numPasses ++
                await sleepMsec(scaledDurationMsec(1000))
            }
            if (this.#node.hasJoinedChannel(channelConfigUrl)) { // only if we belong to this channel
                const rn = this.#remoteNodeManager.getRemoteNode(remoteNodeId)
                if ((!rn) || (!rn.isAuthorizedToCommunicate())) return

                /////////////////////////////////////////////////////////////////////////
                action('announceToNewNode', {context: 'AnnounceService', remoteNodeId}, async () => {
                    await this._announceToNode(remoteNodeId, channelConfigUrl)
                }, null)
                /////////////////////////////////////////////////////////////////////////
            }

        })

        this.#remoteNodeManager.onBootstrapNodeAdded((bootstrapNodeId) => {
            if (this.#halted) return
            const channelConfigUrls = this.#node.joinedChannelConfigUrls()
            for (let channelConfigUrl of channelConfigUrls) {
                /////////////////////////////////////////////////////////////////////////
                action('announceToNewBootstrap', {context: 'AnnounceService', bootstrapNodeId, channelConfigUrl}, async () => {
                    await this._announceToNode(bootstrapNodeId, channelConfigUrl)
                }, null)
                /////////////////////////////////////////////////////////////////////////
            }
        })

        this.#node.onProxyConnectionToServer(() => {
            if (this.#halted) return
            this._announceToAllBootstrapNodes()
        })

        this._start()
    }
    stop() {
        this.#halted = true
    }
    async _announceToNode(remoteNodeId: NodeId, channelConfigUrl: ChannelConfigUrl) {
        let numPasses = 0
        while (!this.#remoteNodeManager.canSendRequestToNode(remoteNodeId, 'default')) {
            numPasses ++
            if (numPasses > 3) return
            await sleepMsec(scaledDurationMsec(1500))
        }
        const requestData: AnnounceRequestData = {
            requestType: 'announce',
            channelNodeInfo: await this.#node.getChannelNodeInfo(channelConfigUrl)
        }
        let method: SendRequestMethod = 'prefer-udp' // we prefer to send via udp so that we can discover our own public udp address when we get the response
        let responseData
        try {
            responseData = await this.#remoteNodeManager.sendRequestToNode(remoteNodeId, requestData, {timeoutMsec: TIMEOUTS.defaultRequest, method})
        }
        catch(err) {
            if ((err instanceof HttpPostJsonError) || (err instanceof RequestTimeoutError)) {
                // the node is probably not connected
                return
            }
            else {
                throw err
            }
        }
        if (!isAnnounceResponseData(responseData)) {
            throw Error('Unexpected.')
        }
        if (!responseData.success) {
            // what should we do here? remove the node?
            console.warn(`Response error for announce: ${responseData.errorMessage}`)
        }
    }
    async _announceToAllBootstrapNodes() {
        const bootstrapNodes: RemoteNode[] = this.#remoteNodeManager.getBootstrapRemoteNodes({includeOffline: false})
        const channelConfigUrls = this.#node.joinedChannelConfigUrls()
        for (let bootstrapNode of bootstrapNodes) {
            for (let channelConfigUrl of channelConfigUrls) {
                if (bootstrapNode.isOnline()) {
                    /////////////////////////////////////////////////////////////////////////
                    await action('announceToNode', {context: 'AnnounceService', bootstrapNodeId: bootstrapNode.remoteNodeId(), channelConfigUrl}, async () => {
                        await this._announceToNode(bootstrapNode.remoteNodeId(), channelConfigUrl)
                    }, async (err: Error) => {
                        console.warn(`Problem announcing to bootstrap node ${bootstrapNode.remoteNodeId().slice(0, 6)} (${err.message})`)
                    });
                    /////////////////////////////////////////////////////////////////////////
                }
            }
        }
    }
    async _start() {
        const timestampStarted = nowTimestamp()
        await sleepMsecNum(2) // important for tests
        // Announce self other nodes in our channels and to bootstrap nodes
        let lastBootstrapAnnounceTimestamp: Timestamp = zeroTimestamp()
        let lastIndividualNodeAnnounceTimestamp: Timestamp = zeroTimestamp()
        while (true) {
            if (this.#halted) return
            const startingUp = elapsedSince(timestampStarted) < durationMsecToNumber(scaledDurationMsec(15000))
            const announceBootstrapIntervalMsec = startingUp ? scaledDurationMsec(2000) : this.opts.announceBootstrapIntervalMsec
            const announceToIndividualNodeIntervalMsec = startingUp ? scaledDurationMsec(500) : this.opts.announceToIndividualNodeIntervalMsec
            // periodically announce to bootstrap nodes
            const elapsedSinceLastBootstrapAnnounce = elapsedSince(lastBootstrapAnnounceTimestamp)
            if (elapsedSinceLastBootstrapAnnounce > durationMsecToNumber(announceBootstrapIntervalMsec)) {
                await this._announceToAllBootstrapNodes()
                lastBootstrapAnnounceTimestamp = nowTimestamp()
            }
            
            const elapsedSinceLastIndividualNodeAnnounce = elapsedSince(lastIndividualNodeAnnounceTimestamp)
            if (elapsedSinceLastIndividualNodeAnnounce > durationMsecToNumber(announceToIndividualNodeIntervalMsec)) {
                // for each channel, choose a node and announce to that node
                const channelConfigUrls = this.#node.joinedChannelConfigUrls()
                for (let channelConfigUrl of channelConfigUrls) {
                    let nodes = this.#remoteNodeManager.getRemoteNodesInChannel(channelConfigUrl, {includeOffline: false})
                    if (nodes.length > 0) {
                        var individualNode = selectNode(nodes, channelConfigUrl, this.#announceHistoryTimestamps)
                        this.#announceHistoryTimestamps.set(getCode(individualNode.remoteNodeId(), channelConfigUrl), nowTimestamp())

                        /////////////////////////////////////////////////////////////////////////
                        await action('announceToIndividualNode', {context: 'AnnounceService', remoteNodeId: individualNode.remoteNodeId(), channelConfigUrl}, async () => {
                            await this._announceToNode(individualNode.remoteNodeId(), channelConfigUrl)
                        }, async (err: Error) => {
                            console.warn(`Problem announcing to individual node ${individualNode.remoteNodeId().slice(0, 6)} (${err.message})`)
                        })
                        /////////////////////////////////////////////////////////////////////////

                    }
                }
                lastIndividualNodeAnnounceTimestamp = nowTimestamp()
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