import { sleepMsec } from "../common/util";
import { formatByteCount } from "../downloadOptimizer/createDownloader";
import { byteCount, ChannelName, durationGreaterThan, DurationMsec, elapsedSince, nowTimestamp, Port, unscaledDurationMsec } from "../interfaces/core";
import KacheryP2PNode from "../KacheryP2PNode";
import RemoteNode, { SendRequestMethod } from "../RemoteNode";
import RemoteNodeManager from "../RemoteNodeManager";

export default class DisplayStateService {
    #node: KacheryP2PNode
    #remoteNodeManager: RemoteNodeManager
    #halted = false
    #lastText = ''
    #lastDisplayTimestamp = nowTimestamp()
    constructor(node: KacheryP2PNode, private opts: {daemonApiPort: Port | null, intervalMsec: DurationMsec}) {
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
        lines.push('=======================================')
        lines.push(`NODE ${this.#node.nodeId().slice(0, 6)} (${this.#node.nodeLabel()})`)
        this.#remoteNodeManager.getBootstrapRemoteNodes({includeOffline: true}).forEach(rn => {
            const connectionString = getConnectionString(rn, null)
            lines.push(`BOOTSTRAP ${rn.remoteNodeId().slice(0, 6)} ${connectionString} (${rn.remoteNodeLabel() || ''})`)
        })
        this.#node.channelNames().forEach(channelName => {
            lines.push(`CHANNEL ${channelName}`)
            this.#remoteNodeManager.getRemoteNodesInChannel(channelName, {includeOffline: true}).forEach(rn => {
                const connectionString = getConnectionString(rn, channelName)
                lines.push(`    ${rn.remoteNodeId().slice(0, 6)} ${connectionString} (${rn.remoteNodeLabel() || ''})`)
            })
        })
        if (this.opts.daemonApiPort)
            lines.push(`http://localhost:${this.opts.daemonApiPort}/stats?format=html`)
        lines.push('=======================================')
        const txt = lines.join('\n')
        const elapsed = unscaledDurationMsec(elapsedSince(this.#lastDisplayTimestamp))
        if ((txt !== this.#lastText) || (durationGreaterThan(elapsed, unscaledDurationMsec(30000)))) {
            this.#lastText = txt
            this.#lastDisplayTimestamp = nowTimestamp()
            console.info(txt)
            console.info(`Downloaded: ${formatByteCount(this.#node.getStats({format: 'json'}).totalBytesReceived.total)}; Uploaded: ${formatByteCount(this.#node.getStats({format: 'json'}).totalBytesSent.total)};`)
            console.info(`Memory used: ${formatByteCount(byteCount(process.memoryUsage().heapUsed))} (heap); ${formatByteCount(byteCount(process.memoryUsage().external))} (external); ${formatByteCount(byteCount(process.memoryUsage().arrayBuffers))} (arrayBuffers);`)
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

const getConnectionString = (rn: RemoteNode, channelName: ChannelName | null) => {
    const onlineString = rn.isOnline() ? '' : '[offline] '
    const candidateMethods: SendRequestMethod[] = ['udp', 'http', 'http-proxy']
    const methods: SendRequestMethod[] = candidateMethods.filter(method => (channelName && rn.canSendRequest(method, channelName)))
    const other: string[] = []
    if (rn.isTrusted()) other.push('trusted')
    if (rn.isBootstrap()) other.push('bootstrap')
    const x = [...methods, ...other]
    return `${onlineString}${x.join(' ')}`
}

const formatMB = (numBytes: number) => {
    const a = numBytes / (1024 * 1024)
    return `${a.toFixed(1)} MB`
}