import { action } from "../common/action";
import { TIMEOUTS } from "../common/constants";
import { sleepMsec, sleepMsecNum } from "../common/util";
import { Address, DurationMsec, JSONObject, urlPath, UrlPath } from "../interfaces/core";
import KacheryP2PNode from "../KacheryP2PNode";
import RemoteNodeManager from "../RemoteNodeManager";
import { isPublicApiProbeResponse } from "../services/PublicApiServer";

export type HttpPostJson = (address: Address, path: UrlPath, data: JSONObject, opts: {timeoutMsec: DurationMsec}) => Promise<JSONObject>

export default class BootstrapService {
    #node: KacheryP2PNode
    #remoteNodeManager: RemoteNodeManager
    #halted = false
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
            throw Error('Invalid probe response from bootstrap node.')
        }
        const {nodeId: remoteNodeId, isBootstrapNode, isMessageProxy, isDataProxy, webSocketAddress} = response
        if (!isBootstrapNode) {
            throw Error('isBootstrapNode is false in probe response from bootstrap node.')
        }
        const publicUdpSocketAddress = response.publicUdpSocketAddress
        this.#remoteNodeManager.setBootstrapNode(remoteNodeId, address, webSocketAddress, publicUdpSocketAddress, {isMessageProxy, isDataProxy})
    }
    async _start() {
        await sleepMsecNum(2) // important for tests
        // probe the bootstrap nodes periodically
        while (true) {
            if (this.#halted) return
            for (let address of this.#node.bootstrapAddresses()) {

                /////////////////////////////////////////////////////////////////////////
                await action('probeBootstrapNode', {context: 'BootstrapService', address}, async () => {
                    await this._probeBootstrapNode(address)
                }, null)
                /////////////////////////////////////////////////////////////////////////
                
            }
            
            await sleepMsec(this.opts.probeIntervalMsec, () => {return !this.#halted})
        }
    }
}