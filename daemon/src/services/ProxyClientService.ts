import { action } from "../common/action";
import GarbageMap from '../common/GarbageMap';
import { sleepMsec } from "../common/util";
import { elapsedSince, NodeId, nowTimestamp, Timestamp, zeroTimestamp } from "../interfaces/core";
import KacheryP2PNode from "../KacheryP2PNode";
import { ProxyConnectionToServer } from "../proxyConnections/ProxyConnectionToServer";
import RemoteNodeManager from "../RemoteNodeManager";
import { DurationMsec, durationMsec } from "../udp/UdpCongestionManager";

export default class ProxyClientService {
    #node: KacheryP2PNode
    #remoteNodeManager: RemoteNodeManager
    #proxyClientManager: ProxyClientManager
    constructor(node: KacheryP2PNode) {
        this.#node = node
        this.#remoteNodeManager = node.remoteNodeManager()
        this.#proxyClientManager = new ProxyClientManager(this.#node);
        this._start();
    }
    async _start() {
        // periodically try to establish proxy connections to the remote nodes
        while (true) {
            const remoteNodes = this.#remoteNodeManager.getAllRemoteNodes()
            for (let remoteNode of remoteNodes) {
                if (remoteNode.getRemoteNodeWebSocketAddress()) {
                    const remoteNodeId = remoteNode.remoteNodeId()
                    const c = this.#node.getProxyConnectionToServer(remoteNodeId)
                    if (!c) {
                        const elapsedMsec = this.#proxyClientManager.elapsedMsecSinceLastFailedOutgoingConnection(remoteNodeId);
                        if (elapsedMsec > 15000) {
                            /////////////////////////////////////////////////////////////////////////
                            action('tryOutgoingProxyConnection', {context: 'ProxyClientService', remoteNodeId}, async () => {
                                await this.#proxyClientManager.tryConnection(remoteNodeId, {timeoutMsec: durationMsec(3000)});
                            }, null);
                            /////////////////////////////////////////////////////////////////////////
                        }
                    }
                }
            }
            await sleepMsec(3000);
        }
    }
}

class ProxyClientManager {
    #node: KacheryP2PNode
    // #outgoingConnections = new Map<NodeId, ProxyConnectionToServer>()
    #failedConnectionAttemptTimestamps = new GarbageMap<NodeId, Timestamp>(durationMsec(120000))
    constructor(node: KacheryP2PNode) {
        this.#node = node
    }
    async tryConnection(remoteNodeId: NodeId, opts: {timeoutMsec: DurationMsec}) {
        const remoteNode = this.#node.remoteNodeManager().getRemoteNode(remoteNodeId)
        if (!remoteNode) return
        const webSocketAddress = remoteNode.getRemoteNodeWebSocketAddress();
        if (!webSocketAddress) {
            return;
        }
        try {
            const c = new ProxyConnectionToServer(this.#node);
            await c.initialize(remoteNodeId, webSocketAddress, {timeoutMsec: opts.timeoutMsec});
            this.#node.setProxyConnectionToServer(remoteNodeId, c)
        }
        catch(err) {
            this.#failedConnectionAttemptTimestamps.set(remoteNodeId, nowTimestamp())
            throw(err);
        }
    }
    elapsedMsecSinceLastFailedOutgoingConnection(remoteNodeId: NodeId): number {
        const timestamp: Timestamp = this.#failedConnectionAttemptTimestamps.get(remoteNodeId) || zeroTimestamp()
        return elapsedSince(timestamp)
    }
    getConnection(remoteNodeId: NodeId): ProxyConnectionToServer | null {
        return this.#node.getProxyConnectionToServer(remoteNodeId)
    }
}