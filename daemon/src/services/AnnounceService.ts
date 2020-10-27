import { action } from "../common/action"
import { sleepMsec, sleepMsecNum } from "../common/util"
import { ChannelName, DurationMsec, durationMsecToNumber, elapsedSince, NodeId, nowTimestamp, scaledDurationMsec, Timestamp, zeroTimestamp } from "../interfaces/core"
import { AnnounceRequestData, isAnnounceResponseData } from "../interfaces/NodeToNodeRequest"
import KacheryP2PNode from "../KacheryP2PNode"
import RemoteNode, { SendRequestMethod } from "../RemoteNode"
import RemoteNodeManager from "../RemoteNodeManager"

export default class AnnounceService {
    #node: KacheryP2PNode
    #remoteNodeManager: RemoteNodeManager
    #halted = false
    constructor(node: KacheryP2PNode, private opts: {announceBootstrapIntervalMsec: DurationMsec, announceToRandomNodeIntervalMsec: DurationMsec}) {
        this.#node = node
        this.#remoteNodeManager = node.remoteNodeManager()
        // announce self when a new node-channel has been added
        this.#remoteNodeManager.onNodeChannelAdded(async (remoteNodeId: NodeId, channelName: ChannelName) => {
            if (this.#halted) return
            // check if we can send message to node, if not, delay a bit
            let numPasses = 0
            while (!this.#remoteNodeManager.canSendRequestToNode(remoteNodeId, 'default')) {
                if (numPasses > 3) return
                numPasses ++
                await sleepMsec(scaledDurationMsec(1000))
            }
            if (this.#node.channelNames().includes(channelName)) { // only if we belong to this channel

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
            await sleepMsec(scaledDurationMsec(1500))
        }
        const requestData: AnnounceRequestData = {
            requestType: 'announce',
            channelNodeInfo: this.#node.getChannelNodeInfo(channelName)
        }
        let method: SendRequestMethod = 'prefer-udp' // we prefer to send via udp so that we can discover our own public udp address when we get the response
        const responseData = await this.#remoteNodeManager.sendRequestToNode(remoteNodeId, requestData, {timeoutMsec: scaledDurationMsec(4000), method})
        if (!isAnnounceResponseData(responseData)) {
            throw Error('Unexpected.')
        }
        if (!responseData.success) {
            // what should we do here? remove the node?
            console.warn(`Response error for announce: ${responseData.errorMessage}`)
        }
    }
    async _announceToAllBootstrapNodes() {
        const bootstrapNodes: RemoteNode[] = this.#remoteNodeManager.getBootstrapRemoteNodes()
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
            await sleepMsec(scaledDurationMsec(500), () => {return !this.#halted})
        }
    }
}

const randomIndex = (n: number): number => {
    return Math.floor(Math.random() * n)
}