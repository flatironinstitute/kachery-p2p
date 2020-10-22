import { action } from "../common/action"
import { sleepMsec, sleepMsecNum } from "../common/util"
import { ChannelName, ChannelNodeInfo, durationMsec, DurationMsec, durationMsecToNumber, elapsedSince, NodeId, nowTimestamp, Timestamp, zeroTimestamp } from "../interfaces/core"
import { AnnounceRequestData, isAnnounceResponseData, NodeToNodeRequestData, NodeToNodeResponseData } from "../interfaces/NodeToNodeRequest"
import { SendRequestMethod } from "../RemoteNode"

interface RemoteNodeManagerInterface {
    onNodeChannelAdded: (callback: (remoteNodeId: NodeId, channelName: ChannelName) => void) => void,
    onBootstrapNodeAdded: (callback: (bootstrapNodeId: NodeId) => void) => void
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
    onProxyConnectionToServer: (callback: (() => void)) => void
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
            
            if (this.#halted) return
            if (this.#node.channelNames().includes(channelName)) { // only if we belong to this channel
                // todo: check if we can send message to node, if not maybe we need to delay a bit

                /////////////////////////////////////////////////////////////////////////
                action('announceToNewNode', {context: 'AnnounceService', remoteNodeId, channelName}, async () => {
                    await this._announceToNode(remoteNodeId, channelName)
                }, null)
                /////////////////////////////////////////////////////////////////////////
            }

        })

        this.#remoteNodeManager.onBootstrapNodeAdded((bootstrapNodeId) => {
            if (this.#halted) return
            const channelNames = this.#node.channelNames()
            for (let channelName of channelNames) {
                /////////////////////////////////////////////////////////////////////////
                action('announceToNewBootstrap', {context: 'AnnounceService', bootstrapNodeId, channelName}, async () => {
                    await this._announceToNode(bootstrapNodeId, channelName)
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
    async _announceToNode(remoteNodeId: NodeId, channelName: ChannelName) {
        let numPasses = 0
        while (!this.#remoteNodeManager.canSendRequestToNode(remoteNodeId, 'default')) {
            numPasses ++
            if (numPasses > 3) return
            await sleepMsec(durationMsec(1500))
        }
        const requestData: AnnounceRequestData = {
            requestType: 'announce',
            channelNodeInfo: this.#node.getChannelNodeInfo(channelName)
        }
        let method: SendRequestMethod = 'prefer-udp' // we prefer to send via udp so that we can discover our own public udp address when we get the response
        const responseData = await this.#remoteNodeManager.sendRequestToNode(remoteNodeId, requestData, {timeoutMsec: durationMsec(2000), method})
        if (!isAnnounceResponseData(responseData)) {
            throw Error('Unexpected.')
        }
        if (!responseData.success) {
            // what should we do here? remove the node?
            console.warn(`Response error for announce: ${responseData.errorMessage}`)
        }
    }
    async _announceToAllBootstrapNodes() {
        const bootstrapNodes: RemoteNodeInterface[] = this.#remoteNodeManager.getBootstrapRemoteNodes()
        const channelNames = this.#node.channelNames()
        for (let bootstrapNode of bootstrapNodes) {
            for (let channelName of channelNames) {

                /////////////////////////////////////////////////////////////////////////
                await action('announceToNode', {context: 'AnnounceService', bootstrapNodeId: bootstrapNode.remoteNodeId(), channelName}, async () => {
                    await this._announceToNode(bootstrapNode.remoteNodeId(), channelName)
                }, null);
                /////////////////////////////////////////////////////////////////////////

            }
        }
    }
    async _start() {
        await sleepMsecNum(2) // important for tests
        // Announce self other nodes in our channels and to bootstrap nodes
        let lastBootstrapAnnounceTimestamp: Timestamp = zeroTimestamp()
        let lastRandomNodeAnnounceTimestamp: Timestamp = zeroTimestamp()
        while (true) {
            if (this.#halted) return
            // periodically announce to bootstrap nodes
            const elapsedSinceLastBootstrapAnnounce = elapsedSince(lastBootstrapAnnounceTimestamp)
            if (elapsedSinceLastBootstrapAnnounce > durationMsecToNumber(this.opts.announceBootstrapIntervalMsec)) {
                await this._announceToAllBootstrapNodes()
                lastBootstrapAnnounceTimestamp = nowTimestamp()
            }
            
            
            const elapsedSinceLastRandomNodeAnnounce = elapsedSince(lastRandomNodeAnnounceTimestamp)
            if (elapsedSinceLastRandomNodeAnnounce > durationMsecToNumber(this.opts.announceToRandomNodeIntervalMsec)) {
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
                lastRandomNodeAnnounceTimestamp = nowTimestamp()
            }
            await sleepMsec(durationMsec(500), () => {return !this.#halted})
        }
    }
}

const randomIndex = (n: number): number => {
    return Math.floor(Math.random() * n)
}