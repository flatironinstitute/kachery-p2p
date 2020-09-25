import { action } from "./action";
import { sleepMsec } from "./common/util";
import { httpPostJson } from "./httpPostJson";
import { Address, ChannelName, NodeId } from "./interfaces/core";
import { AnnounceRequestData, GetChannelInfoRequestData, isAnnounceResponseData, isGetChannelInfoResponseData, NodeToNodeRequestData, NodeToNodeResponseData } from "./interfaces/NodeToNodeRequest";
import KacheryP2PNode from "./KacheryP2PNode";
import { ProxyConnectionToServer } from "./ProxyConnectionToServer";
import { isApiProbeResponse } from "./PublicApiServer";
import RemoteNode from "./RemoteNode";
import RemoteNodeManager from "./RemoteNodeManager";

export class KacheryP2PController {
    #node: KacheryP2PNode
    #announceService: AnnounceService
    #findChannelNodesService: FindChannelNodesService
    #bootstrapService: BootstrapService
    #proxyClientService: ProxyClientService
    constructor(node: KacheryP2PNode, bootstrapAddresses: Address[]) {
        this.#node = node
        this.#announceService = new AnnounceService(this)
        this.#findChannelNodesService = new FindChannelNodesService(this)
        this.#bootstrapService = new BootstrapService(this)
        this.#proxyClientService = new ProxyClientService(this)
    }
    node() {
        return this.#node
    }
}

class BootstrapService {
    #node: KacheryP2PNode
    #remoteNodeManager: RemoteNodeManager
    constructor(controller: KacheryP2PController) {
        this.#node = controller.node()
        this.#remoteNodeManager = controller.node().remoteNodeManager()
        this._start();
    }
    async _probeBootstrapNode(address: Address) {
        const response = await httpPostJson(address, '/probe', {}, {timeoutMsec: 2000});
        if (!isApiProbeResponse(response)) {
            throw Error('Invalid probe response from bootstrap node.');
        }
        const {nodeId: remoteNodeId, isBootstrapNode, webSocketAddress} = response
        if (!isBootstrapNode) {
            throw Error('isBootstrapNode is false in probe response from bootstrap node.')
        }
        this.#remoteNodeManager.setBootstrapNode(remoteNodeId, address, webSocketAddress)
    }
    async _start() {
        // probe the bootstrap nodes periodically
        while (true) {
            for (let address of this.#node.bootstrapAddresses()) {
                action('probeBootstrapNode', {context: 'BootstrapService', address}, async () => {
                    await this._probeBootstrapNode(address)
                }, null);
            }
            await sleepMsec(15000);
        }
    }
}

class AnnounceService {
    #node: KacheryP2PNode
    #remoteNodeManager: RemoteNodeManager
    constructor(controller: KacheryP2PController) {
        this.#node = controller.node()
        this.#remoteNodeManager = controller.node().remoteNodeManager()
        // announce self when a new node-channel has been added
        this.#remoteNodeManager.onNodeChannelAdded((remoteNodeId: NodeId, channelName: ChannelName) => {
            action('announceToNewNode', {context: 'AnnounceService', remoteNodeId, channelName}, async () => {
                await this._announceToNode(remoteNodeId, channelName)
            }, null);
        })
        this._start();
    }
    async _announceToNode(remoteNodeId: NodeId, channelName: ChannelName) {
        const requestData: AnnounceRequestData = {
            requestType: 'announce',
            channelNodeInfo: this.#node.getChannelNodeInfo(channelName)
        }
        const responseData = await this.#remoteNodeManager.sendRequestToNode(remoteNodeId, requestData, {timeoutMsec: 2000})
        if (!isAnnounceResponseData(responseData)) {
            throw Error('Unexpected.');
        }
        if (!responseData.success) {
            console.warn(`Response error for announce: ${responseData.errorMessage}`);
        }
    }
    async _start() {
        // announce self to bootstrap nodes periodically
        while (true) {
            const bootstrapNodes: RemoteNode[] = this.#remoteNodeManager.getBootstrapRemoteNodes();
            const channelNames = this.#node.channelNames();
            for (let bootstrapNode of bootstrapNodes) {
                for (let channelName of channelNames) {
                    action('announceToNode', {context: 'AnnounceService', bootstrapNodeId: bootstrapNode.remoteNodeId(), channelName}, async () => {
                        await this._announceToNode(bootstrapNode.remoteNodeId(), channelName);
                    }, null);
                }
            }
            await sleepMsec(20000);
        }
    }
}

class FindChannelNodesService {
    #node: KacheryP2PNode
    #remoteNodeManager: RemoteNodeManager
    constructor(controller: KacheryP2PController) {
        this.#node = controller.node()
        this.#remoteNodeManager = controller.node().remoteNodeManager()
        this._start();
    }
    async _getChannelInfoFromNode(remoteNodeId: NodeId, channelName: ChannelName) {
        const requestData: GetChannelInfoRequestData = {
            requestType: 'getChannelInfo',
            channelName
        }
        const responseData = await this.#remoteNodeManager.sendRequestToNode(remoteNodeId, requestData, {timeoutMsec: 3000})
        if (!isGetChannelInfoResponseData(responseData)) {
            throw Error('Unexpected.');
        }
        const { channelInfo } = responseData;
        channelInfo.nodes.forEach(channelNodeInfo => {
            this.#remoteNodeManager.setChannelNodeInfo(channelNodeInfo)
        })
    }
    async _start() {
        // periodically get channel info from bootstrap nodes, and also from a randomly selected node from the channel
        while (true) {
            const bootstrapNodes: RemoteNode[] = this.#remoteNodeManager.getBootstrapRemoteNodes();
            const channelNames = this.#node.channelNames();
            for (let bootstrapNode of bootstrapNodes) {
                for (let channelName of channelNames) {
                    action('getChannelInfoFromBootstrapNode', {context: 'FindChannelNodesService', bootstrapNodeId: bootstrapNode.remoteNodeId(), channelName}, async () => {
                        await this._getChannelInfoFromNode(bootstrapNode.remoteNodeId(), channelName);
                    }, null);
                }
            }
            for (let channelName of channelNames) {
                let nodes = this.#remoteNodeManager.getRemoteNodesInChannel(channelName);
                if (nodes.length > 0) {
                    var randomNode = nodes[randomIndex(nodes.length)];
                    action('getChannelInfoFromRandomNode', {context: 'FindChannelNodesService', remoteNodeId: randomNode.remoteNodeId(), channelName}, async () => {
                        await this._getChannelInfoFromNode(randomNode.remoteNodeId(), channelName);
                    }, null);
                }
            }
            await sleepMsec(25000);
        }
    }
}

class ProxyClientManager {
    #node: KacheryP2PNode
    #outgoingConnections = new Map<NodeId, ProxyConnectionToServer>()
    constructor(node: KacheryP2PNode) {
        this.#node = node
    }
    async tryConnection(remoteNodeId: NodeId, {timeoutMsec: number}) {
        if (this.#outgoingConnections.has(remoteNodeId)) return;
        const webSocketAddress = this.#node.remoteNodeManager().getRemoteNodeWebSocketAddress(remoteNodeId);
        if (!webSocketAddress) {
            return;
        }
        const c = new ProxyConnectionToServer(this.#node);
        await c.initialize(remoteNodeId, webSocketAddress, {timeoutMsec: 3000});
        this.#outgoingConnections.set(remoteNodeId, c);
    }
    getConnection(remoteNodeId: NodeId): ProxyConnectionToServer | null {
        return this.#outgoingConnections.get(remoteNodeId) || null
    }
}

class ProxyClientService {
    #node: KacheryP2PNode
    #remoteNodeManager: RemoteNodeManager
    #proxyClientManager: ProxyClientManager
    constructor(controller: KacheryP2PController) {
        this.#node = controller.node()
        this.#remoteNodeManager = this.#node.remoteNodeManager()
        this.#proxyClientManager = new ProxyClientManager(this.#node);
        this._start();
    }
    async _start() {
        // periodically try to establish proxy connections to the bootstrap servers
        while (true) {
            const bootstrapNodes: RemoteNode[] = this.#remoteNodeManager.getBootstrapRemoteNodes();
            for (let bootstrapNode of bootstrapNodes) {
                const remoteNodeId = bootstrapNode.remoteNodeId()
                const c = this.#proxyClientManager.getConnection(remoteNodeId)
                if (!c) {
                    action('tryOutgoingProxyConnection', {context: 'ProxyClientService', remoteNodeId}, async () => {
                        await this.#proxyClientManager.tryConnection(remoteNodeId, {timeoutMsec: 3000});
                    }, null);
                }
            }
            await sleepMsec(10000);
        }
    }
}

const randomIndex = (n: number): number => {
    return Math.floor(Math.random() * n);
}