import { action } from '../common/action';
import { TIMEOUTS } from '../common/constants';
import GarbageMap from '../common/GarbageMap';
import { sleepMsec } from "../common/util";
import { durationGreaterThan, DurationMsec, elapsedSince, NodeId, nowTimestamp, scaledDurationMsec, Timestamp, unscaledDurationMsec, zeroTimestamp } from "../interfaces/core";
import KacheryP2PNode from "../KacheryP2PNode";
import { ProxyWebsocketConnection } from "../proxyConnections/ProxyWebsocketConnection";
import RemoteNodeManager from "../RemoteNodeManager";

export default class ProxyClientService {
    #node: KacheryP2PNode
    #remoteNodeManager: RemoteNodeManager
    #proxyClientManager: ProxyClientManager
    #halted = false
    constructor(node: KacheryP2PNode, private opts: {intervalMsec: DurationMsec}) {
        this.#node = node
        this.#remoteNodeManager = node.remoteNodeManager()
        this.#proxyClientManager = new ProxyClientManager(this.#node)

        // this.#remoteNodeManager.onBootstrapNodeAdded((bootstrapNodeId) => {
        //     const rn = this.#remoteNodeManager.getRemoteNode(bootstrapNodeId)
        //     if ((rn) && (rn.getRemoteNodeWebSocketAddress())) {
        //         /////////////////////////////////////////////////////////////////////////
        //         action('tryOutgoingProxyConnectionForNewBootstrapNode', {context: 'ProxyClientService', bootstrapNodeId}, async () => {
        //             await this.#proxyClientManager.tryConnection(bootstrapNodeId, {timeoutMsec: TIMEOUTS.websocketConnect});
        //         }, null)
        //         /////////////////////////////////////////////////////////////////////////
        //     }
        // })

        this._start()
    }
    stop() {
        this.#halted = true
    }
    async _start() {
        // periodically try to establish proxy connections to the remote nodes
        while (true) {
            if (this.#halted) return
            const channelConfigUrls = this.#node.joinedChannelConfigUrls()
            const messageProxyNodeIds = new Set<NodeId>()
            const dataProxyNodeIds = new Set<NodeId>()
            for (const channelConfigUrl of channelConfigUrls) {
                const channelConfig = await this.#node.getChannelConfig(channelConfigUrl)
                if (channelConfig) {
                    for (const nn of channelConfig.authorizedNodes) {
                        if (nn.isMessageProxy) messageProxyNodeIds.add(nn.nodeId)
                        if (nn.isDataProxy) dataProxyNodeIds.add(nn.nodeId)
                    }
                }
            }
            const remoteNodes = this.#remoteNodeManager.getAllRemoteNodes({includeOffline: false})
            for (let remoteNode of remoteNodes) {
                const isMessageProxy = messageProxyNodeIds.has(remoteNode.remoteNodeId())
                const isDataProxy = dataProxyNodeIds.has(remoteNode.remoteNodeId())
                if ((isMessageProxy) || (isDataProxy)) {
                    if ((remoteNode.isOnline()) && (remoteNode.getRemoteNodeWebSocketAddress())) {
                        const remoteNodeId = remoteNode.remoteNodeId()
                        const c = this.#node.getProxyConnectionToServer(remoteNodeId)
                        if (!c) {
                            const elapsedMsec = this.#proxyClientManager.elapsedMsecSinceLastFailedOutgoingConnection(remoteNodeId)
                            if (durationGreaterThan(elapsedMsec, scaledDurationMsec(15000))) {
                                ///////////////////////////////////////////////////////////////////////
                                await action('tryOutgoingProxyConnection', {context: 'ProxyClientService', remoteNodeId}, async () => {
                                    await this.#proxyClientManager.tryConnection(remoteNodeId, {timeoutMsec: TIMEOUTS.websocketConnect, isMessageProxy, isDataProxy});
                                }, async (err: Error) => {
                                    console.warn(`Problem establishing outgoing proxy connection to ${remoteNode.remoteNodeId().slice(0, 6)} (${err.message})`)
                                })
                                ///////////////////////////////////////////////////////////////////////
                            }
                        }
                    }
                }
            }
            await sleepMsec(this.opts.intervalMsec, () => {return !this.#halted})
        }
    }
}

class ProxyClientManager {
    #node: KacheryP2PNode
    // #outgoingConnections = new Map<NodeId, ProxyConnectionToServer>()
    #failedConnectionAttemptTimestamps = new GarbageMap<NodeId, Timestamp>(scaledDurationMsec(120 * 1000))
    constructor(node: KacheryP2PNode) {
        this.#node = node
    }
    async tryConnection(remoteNodeId: NodeId, opts: {timeoutMsec: DurationMsec, isMessageProxy: boolean, isDataProxy: boolean}) {
        const remoteNode = this.#node.remoteNodeManager().getRemoteNode(remoteNodeId)
        if (!remoteNode) return
        const webSocketAddress = remoteNode.getRemoteNodeWebSocketAddress()
        if (!webSocketAddress) {
            return;
        }
        try {
            const c = new ProxyWebsocketConnection(this.#node, {connectionType: 'connectionToServer', isMessageProxy: opts.isMessageProxy, isDataProxy: opts.isDataProxy})
            await c.initializeConnectionToServer(remoteNodeId, webSocketAddress, {timeoutMsec: opts.timeoutMsec});
            this.#node.setProxyConnectionToServer(remoteNodeId, c)
        }
        catch(err) {
            this.#failedConnectionAttemptTimestamps.set(remoteNodeId, nowTimestamp())
            throw(err);
        }
    }
    elapsedMsecSinceLastFailedOutgoingConnection(remoteNodeId: NodeId): DurationMsec {
        const timestamp: Timestamp = this.#failedConnectionAttemptTimestamps.get(remoteNodeId) || zeroTimestamp()
        return unscaledDurationMsec(elapsedSince(timestamp))
    }
    getConnection(remoteNodeId: NodeId): ProxyWebsocketConnection | null {
        return this.#node.getProxyConnectionToServer(remoteNodeId)
    }
}