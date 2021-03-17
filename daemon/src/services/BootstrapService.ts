import { action } from "../common/action";
import { TIMEOUTS } from "../common/constants";
import { JSONStringifyDeterministic } from "../common/crypto_util";
import { sleepMsec, sleepMsecNum } from "../common/util";
import { Address, DurationMsec, durationMsecToNumber, elapsedSince, JSONObject, nowTimestamp, scaledDurationMsec, urlPath, UrlPath } from "../interfaces/core";
import KacheryP2PNode from "../KacheryP2PNode";
import { protocolVersion } from "../protocolVersion";
import RemoteNodeManager from "../RemoteNodeManager";
import { isPublicApiProbeResponse } from "../services/PublicApiServer";

export type HttpPostJson = (address: Address, path: UrlPath, data: JSONObject, opts: {timeoutMsec: DurationMsec}) => Promise<JSONObject>

export default class BootstrapService {
    #node: KacheryP2PNode
    #remoteNodeManager: RemoteNodeManager
    #halted = false
    #printedWarnings = new Set<string>()
    constructor(node: KacheryP2PNode, private opts: {probeIntervalMsec: DurationMsec}) {
        this.#node = node
        this.#remoteNodeManager = node.remoteNodeManager()
        this._start()
    }
    stop() {
        this.#halted = true
    }
    async _probeBootstrapNode(address: Address) {
        const response = await this.#node.externalInterface().httpPostJson(address, urlPath('/probe'), {}, {timeoutMsec: TIMEOUTS.defaultRequest});
        if (!isPublicApiProbeResponse(response)) {
            if ((response.protocolVersion) && (response.protocolVersion !== protocolVersion().toString())) {
                const warningCode = JSONStringifyDeterministic(address)
                if (!this.#printedWarnings.has(warningCode)) {
                    this.#printedWarnings.add(warningCode)
                    console.warn('############################')
                    console.warn(`Protocol version does not match with bootstrap node ${address.hostName}:${address.port}: ${protocolVersion()} <> ${response.protocolVersion}`)
                    console.warn('You may need to update one or both of these nodes to the latest version of kachery-p2p')
                    console.warn('')
                }
                return
            }
            throw Error('Invalid probe response from bootstrap node.')
        }
        const {nodeId: remoteNodeId, isBootstrapNode, webSocketAddress} = response
        if (!isBootstrapNode) {
            throw Error('isBootstrapNode is false in probe response from bootstrap node.')
        }
        const publicUdpSocketAddress = response.publicUdpSocketAddress
        this.#remoteNodeManager.setBootstrapNode(remoteNodeId, address, webSocketAddress, publicUdpSocketAddress)
    }
    async _start() {
        const timestampStarted = nowTimestamp()
        await sleepMsecNum(2) // important for tests
        // probe the bootstrap nodes periodically
        while (true) {
            if (this.#halted) return
            const startingUp = elapsedSince(timestampStarted) < durationMsecToNumber(scaledDurationMsec(10000))
            const probeIntervalMsec = startingUp ? scaledDurationMsec(1000) : this.opts.probeIntervalMsec
            const allBootstrapAddresses: Address[] = []
            const channelConfigUrls = this.#node.joinedChannelConfigUrls()
            for (let channelConfigUrl of channelConfigUrls) {
                const channelConfig = await this.#node.getChannelConfig(channelConfigUrl)
                if (channelConfig) {
                    for (let address of channelConfig.bootstrapAddresses) {
                        allBootstrapAddresses.push(address)
                    }
                }
            }

            const uniqueBootstrapAddresses = getUniqueAddresses(allBootstrapAddresses)
            for (let address of uniqueBootstrapAddresses) {
                /////////////////////////////////////////////////////////////////////////
                await action('probeBootstrapNode', {context: 'BootstrapService', address}, async () => {
                    await this._probeBootstrapNode(address)
                }, async (err: Error) => {
                    console.warn(`Problem probing bootstrap node ${address} (${err.message})`)
                })
                /////////////////////////////////////////////////////////////////////////
            }
            
            await sleepMsec(probeIntervalMsec, () => {return !this.#halted})
        }
    }
}

const getUniqueAddresses = (addresses: Address[]) => {
    const used = new Set<String>()
    const ret: Address[] = []
    addresses.forEach(a => {
        const code = JSONStringifyDeterministic(a)
        if (!used.has(code)) {
            ret.push(a)
            used.add(code)
        }
    })
    return ret
}