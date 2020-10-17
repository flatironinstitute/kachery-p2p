import { action } from "../common/action"
import { sleepMsec } from "../common/util"
import { ChannelName, ChannelNodeInfo, durationMsec, DurationMsec, durationMsecToNumber, elapsedSince, NodeId, nowTimestamp, Timestamp, zeroTimestamp } from "../interfaces/core"
import { AnnounceRequestData, isAnnounceResponseData, NodeToNodeRequestData, NodeToNodeResponseData } from "../interfaces/NodeToNodeRequest"
import { SendRequestMethod } from "../RemoteNode"

interface RemoteNodeManagerInterface {
    onNodeChannelAdded: (callback: (remoteNodeId: NodeId, channelName: ChannelName) => void) => void,
    sendRequestToNode: (remoteNodeId: NodeId, requestData: NodeToNodeRequestData, opts: {timeoutMsec: DurationMsec, method: SendRequestMethod}) => Promise<NodeToNodeResponseData>,
    getBootstrapRemoteNodes: () => RemoteNodeInterface[]
    getRemoteNodesInChannel: (channelName: ChannelName) => RemoteNodeInterface[]
    canSendRequestToNode: (remoteNodeId: NodeId, method: SendRequestMethod) => boolean
}

interface RemoteNodeInterface {
    remoteNodeId: () => NodeId
}

interface KacheryP2PNodeInterface {
    nodeId: () => NodeId
    remoteNodeManager: () => RemoteNodeManagerInterface
    getChannelNodeInfo: (channelName: ChannelName) => ChannelNodeInfo
    channelNames: () => ChannelName[]
    isBootstrapNode: () => boolean
}

export default class AnnounceService {
    #node: KacheryP2PNodeInterface
    #remoteNodeManager: RemoteNodeManagerInterface
    #halted = false
    constructor(node: KacheryP2PNodeInterface, private opts: {announceBootstrapIntervalMsec: DurationMsec, announceToRandomNodeIntervalMsec: DurationMsec}) {
        this.#node = node
        this.#remoteNodeManager = node.remoteNodeManager()
        // announce self when a new node-channel has been added
        this.#remoteNodeManager.onNodeChannelAdded((remoteNodeId: NodeId, channelName: ChannelName) => {
            
            if (this.#node.channelNames().includes(channelName)) { // only if we belong to this channel
                // todo: check if we can send message to node, if not maybe we need to delay a bit

                /////////////////////////////////////////////////////////////////////////
                action('announceToNewNode', {context: 'AnnounceService', remoteNodeId, channelName}, async () => {
                    await this._announceToNode(remoteNodeId, channelName)
                }, null)
                /////////////////////////////////////////////////////////////////////////
            }

        })
        this._start()
    }
    stop() {
        this.#halted = true
    }
    async _announceToNode(remoteNodeId: NodeId, channelName: ChannelName) {
        if (!this.#remoteNodeManager.canSendRequestToNode(remoteNodeId, 'default')) {
            return
        }
        const requestData: AnnounceRequestData = {
            requestType: 'announce',
            channelNodeInfo: this.#node.getChannelNodeInfo(channelName)
        }
        const responseData = await this.#remoteNodeManager.sendRequestToNode(remoteNodeId, requestData, {timeoutMsec: durationMsec(2000), method: 'default'})
        if (!isAnnounceResponseData(responseData)) {
            throw Error('Unexpected.')
        }
        if (!responseData.success) {
            // what should we do here? remove the node?
            console.warn(`Response error for announce: ${responseData.errorMessage}`)
        }
    }
    async _start() {
        await sleepMsec(2) // important for tests
        // Announce self other nodes in our channels and to bootstrap nodes
        let lastBootstrapAnnounceTimestamp: Timestamp = zeroTimestamp()
        while (true) {
            if (this.#halted) return
            // periodically announce to bootstrap nodes
            const elapsedSinceLastBootstrapAnnounce = elapsedSince(lastBootstrapAnnounceTimestamp)
            if (elapsedSinceLastBootstrapAnnounce > durationMsecToNumber(this.opts.announceBootstrapIntervalMsec)) {
                const bootstrapNodes: RemoteNodeInterface[] = this.#remoteNodeManager.getBootstrapRemoteNodes()
                const channelNames = this.#node.channelNames();
                for (let bootstrapNode of bootstrapNodes) {
                    for (let channelName of channelNames) {

                        /////////////////////////////////////////////////////////////////////////
                        await action('announceToNode', {context: 'AnnounceService', bootstrapNodeId: bootstrapNode.remoteNodeId(), channelName}, async () => {
                            await this._announceToNode(bootstrapNode.remoteNodeId(), channelName)
                        }, null);
                        /////////////////////////////////////////////////////////////////////////

                    }
                }
                lastBootstrapAnnounceTimestamp = nowTimestamp()
            }
            
            // for each channel, choose a random node and announce to that node
            const channelNames = this.#node.channelNames()
            for (let channelName of channelNames) {
                let nodes = this.#remoteNodeManager.getRemoteNodesInChannel(channelName)
                if (nodes.length > 0) {
                    var randomNode = nodes[randomIndex(nodes.length)]

                    /////////////////////////////////////////////////////////////////////////
                    await action('announceToRandomNode', {context: 'AnnounceService', remoteNodeId: randomNode.remoteNodeId(), channelName}, async () => {
                        await this._announceToNode(randomNode.remoteNodeId(), channelName)
                    }, null)
                    /////////////////////////////////////////////////////////////////////////

                }
            }
            await sleepMsec(durationMsecToNumber(this.opts.announceToRandomNodeIntervalMsec), () => {return !this.#halted})
        }
    }
}

const randomIndex = (n: number): number => {
    return Math.floor(Math.random() * n)
}