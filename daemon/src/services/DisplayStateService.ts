import { sleepMsec } from "../common/util";
import { DurationMsec } from "../interfaces/core";
import KacheryP2PNode from "../KacheryP2PNode";
import RemoteNodeManager from "../RemoteNodeManager";

export default class DisplayStateService {
    #node: KacheryP2PNode
    #remoteNodeManager: RemoteNodeManager
    #halted = false
    #lastText = ''
    constructor(node: KacheryP2PNode, private opts: {intervalMsec: DurationMsec}) {
        this.#node = node
        this.#remoteNodeManager = node.remoteNodeManager()

        this.#remoteNodeManager.onBootstrapNodeAdded((bootstrapNodeId) => {
            const rn = this.#remoteNodeManager.getRemoteNode(bootstrapNodeId)
            if (!rn) {
                /* istanbul ignore next */
                throw Error('Bootstrap node added, but unable to find remote node')
            }
            console.info(`Bootstrap node added: ${bootstrapNodeId.slice(0, 6)}`) // to print label
            this._updateDisplay()
        })
        this.#remoteNodeManager.onNodeChannelAdded((remoteNodeId, channelName) => {
            console.info(`Node added to channel ${channelName}: ${remoteNodeId.slice(0, 6)}`)
            this._updateDisplay()
        })

        this._start()
    }
    stop() {
        this.#halted = true
    }
    _updateDisplay() {
        const lines: string[] = []
        lines.push('=======================================================')
        lines.push(`NODE ${this.#node.nodeId().slice(0, 6)}`)
        this.#remoteNodeManager.getBootstrapRemoteNodes().forEach(rn => {
            lines.push(`BOOTSTRAP ${rn.remoteNodeId().slice(0, 6)}`)
        })
        this.#node.channelNames().forEach(channelName => {
            lines.push(`CHANNEL ${channelName}`)
            this.#remoteNodeManager.getRemoteNodesInChannel(channelName).forEach(rn => {
                lines.push(`    REMOTE ${rn.remoteNodeId().slice(0, 6)}`)
            })
        })
        lines.push('=======================================================')
        const txt = lines.join('\n')
        if (txt !== this.#lastText) {
            this.#lastText = txt
            console.info(txt)
        }
    }
    async _start() {
        while (true) {
            if (this.#halted) return
            this._updateDisplay()
            await sleepMsec(this.opts.intervalMsec, () => {return !this.#halted})
        }
    }
}