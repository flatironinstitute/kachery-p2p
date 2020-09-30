import { action } from "./action";
import { sleepMsec } from "./common/util";
import { httpPostJson, urlPath } from "./httpPostJson";
import { Address, ChannelName, elapsedSince, isMulticastAnnounceMessage, JSONObject, MulticastAnnounceMessage, MulticastAnnounceMessageBody, NodeId, nodeIdToPublicKey, nowTimestamp, Timestamp, tryParseJsonObject, zeroTimestamp } from "./interfaces/core";
import { AnnounceRequestData, GetChannelInfoRequestData, isAnnounceResponseData, isGetChannelInfoResponseData, NodeToNodeRequestData, NodeToNodeResponseData } from "./interfaces/NodeToNodeRequest";
import KacheryP2PNode from "./KacheryP2PNode";
import { ProxyConnectionToServer } from "./ProxyConnectionToServer";
import { isApiProbeResponse } from "./PublicApiServer";
import RemoteNode from "./RemoteNode";
import RemoteNodeManager from "./RemoteNodeManager";
import GarbageMap from './common/GarbageMap'
import dgram from 'dgram'
import { getSignature, verifySignature } from "./common/crypto_util";
import { protocolVersion } from "./protocolVersion";

export class KacheryP2PController {
    #node: KacheryP2PNode
    #announceService: AnnounceService
    #discoverService: DiscoverService
    #bootstrapService: BootstrapService
    #proxyClientService: ProxyClientService
    #multicastService: MulticastService
    constructor(node: KacheryP2PNode, bootstrapAddresses: Address[]) {
        this.#node = node
        this.#announceService = new AnnounceService(this)
        this.#discoverService = new DiscoverService(this)
        this.#bootstrapService = new BootstrapService(this)
        this.#proxyClientService = new ProxyClientService(this)
        this.#multicastService = new MulticastService(this)
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
        const response = await httpPostJson(address, urlPath('/probe'), {}, {timeoutMsec: 2000});
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
        // Announce self other nodes in our channels and to bootstrap nodes
        let lastBootstrapAnnounceTimestamp: Timestamp = zeroTimestamp();
        while (true) {
            // periodically announce to bootstrap nodes
            const elapsedSinceLastBootstrapAnnounce = elapsedSince(lastBootstrapAnnounceTimestamp);
            if (elapsedSinceLastBootstrapAnnounce > 21000) {
                const bootstrapNodes: RemoteNode[] = this.#remoteNodeManager.getBootstrapRemoteNodes();
                const channelNames = this.#node.channelNames();
                for (let bootstrapNode of bootstrapNodes) {
                    for (let channelName of channelNames) {
                        action('announceToNode', {context: 'AnnounceService', bootstrapNodeId: bootstrapNode.remoteNodeId(), channelName}, async () => {
                            await this._announceToNode(bootstrapNode.remoteNodeId(), channelName);
                        }, null);
                    }
                }
                lastBootstrapAnnounceTimestamp = nowTimestamp();
            }
            
            // for each channel, choose a random node and announce to that node
            const channelNames = this.#node.channelNames();
            for (let channelName of channelNames) {
                let nodes = this.#remoteNodeManager.getRemoteNodesInChannel(channelName);
                if (nodes.length > 0) {
                    var randomNode = nodes[randomIndex(nodes.length)];
                    action('announceToRandomNode', {context: 'AnnounceService', remoteNodeId: randomNode.remoteNodeId(), channelName}, async () => {
                        await this._announceToNode(randomNode.remoteNodeId(), channelName);
                    }, null);
                }
            }
            await sleepMsec(2000);
        }
    }
}

class DiscoverService {
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
        // Get channel info from other nodes in our channels
        let lastBootstrapDiscoverTimestamp: Timestamp = zeroTimestamp();
        while (true) {
            // periodically get channel info from bootstrap nodes
            const elapsedSinceLastBootstrapDiscover = elapsedSince(lastBootstrapDiscoverTimestamp);
            if (elapsedSinceLastBootstrapDiscover > 30000) {
                const bootstrapNodes: RemoteNode[] = this.#remoteNodeManager.getBootstrapRemoteNodes();
                const channelNames = this.#node.channelNames();
                for (let bootstrapNode of bootstrapNodes) {
                    for (let channelName of channelNames) {
                        action('getChannelInfoFromBootstrapNode', {context: 'FindChannelNodesService', bootstrapNodeId: bootstrapNode.remoteNodeId(), channelName}, async () => {
                            await this._getChannelInfoFromNode(bootstrapNode.remoteNodeId(), channelName);
                        }, null);
                    }
                }
                lastBootstrapDiscoverTimestamp = nowTimestamp();
            }
            
            // for each channel, choose a random node and get the channel info from that node
            const channelNames = this.#node.channelNames();
            for (let channelName of channelNames) {
                let nodes = this.#remoteNodeManager.getRemoteNodesInChannel(channelName);
                if (nodes.length > 0) {
                    var randomNode = nodes[randomIndex(nodes.length)];
                    action('getChannelInfoFromRandomNode', {context: 'FindChannelNodesService', remoteNodeId: randomNode.remoteNodeId(), channelName}, async () => {
                        await this._getChannelInfoFromNode(randomNode.remoteNodeId(), channelName);
                    }, null);
                }
            }
            await sleepMsec(2000);
        }
    }
}

class ProxyClientManager {
    #node: KacheryP2PNode
    #outgoingConnections = new Map<NodeId, ProxyConnectionToServer>()
    #failedConnectionAttemptTimestamps = new GarbageMap<NodeId, Timestamp>(120000)
    constructor(node: KacheryP2PNode) {
        this.#node = node
    }
    async tryConnection(remoteNodeId: NodeId, {timeoutMsec: number}) {
        if (this.#outgoingConnections.has(remoteNodeId)) return;
        const webSocketAddress = this.#node.remoteNodeManager().getRemoteNodeWebSocketAddress(remoteNodeId);
        if (!webSocketAddress) {
            return;
        }
        try {
            const c = new ProxyConnectionToServer(this.#node);
            await c.initialize(remoteNodeId, webSocketAddress, {timeoutMsec: 3000});
            this.#outgoingConnections.set(remoteNodeId, c);
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
                    const elapsedMsec = this.#proxyClientManager.elapsedMsecSinceLastFailedOutgoingConnection(remoteNodeId);
                    if (elapsedMsec > 15000) {
                        action('tryOutgoingProxyConnection', {context: 'ProxyClientService', remoteNodeId}, async () => {
                            await this.#proxyClientManager.tryConnection(remoteNodeId, {timeoutMsec: 3000});
                        }, null);
                    }
                }
            }
            await sleepMsec(3000);
        }
    }
}

class MulticastService {
    #node: KacheryP2PNode
    constructor(controller: KacheryP2PController) {
        this.#node = controller.node()
        this._start();
    }
    async _start() {
        // to find nodes on the local network
        const multicastSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });
        const multicastAddress = '237.0.0.0'; // not sure how to choose this
        const multicastPort = 21010;
        multicastSocket.bind(multicastPort);
        multicastSocket.on("listening", function() {
            multicastSocket.addMembership(multicastAddress);
        });
        multicastSocket.on("message", (message, rinfo) => {
            let msg: JSONObject | null = tryParseJsonObject(message.toString());
            if (isMulticastAnnounceMessage(msg)) {
                const msg2: MulticastAnnounceMessage = msg;
                action('handleMulticastAnnounceMessage', {fromNodeId: msg.body.fromNodeId}, async () => {
                    if (verifySignature(msg2.body, msg2.signature, nodeIdToPublicKey(msg2.body.fromNodeId), {checkTimestamp: true})) {
                        const response = this.#node._handleAnnounceRequest({ fromNodeId: msg2.body.fromNodeId, requestData: msg2.body.requestData });
                        // don't do anything with response here
                    }
                }, async (err: Error) => {
                    //
                });
            }
        });
        await sleepMsec(1000);
        while (true) {
            for (let channelName of this.#node.channelNames()) {
                const requestData: AnnounceRequestData = {
                    requestType: 'announce',
                    channelNodeInfo: this.#node.getChannelNodeInfo(channelName)
                }
                const body: MulticastAnnounceMessageBody = {
                    protocolVersion: protocolVersion(),
                    fromNodeId: this.#node.nodeId(),
                    messageType: 'announce',
                    requestData
                };
                const m: MulticastAnnounceMessage = {
                    body,
                    signature: getSignature(body, this.#node.keyPair())
                };
                const mJson: string = JSON.stringify(m);
                action('sendMulticastAnnounceMessage', {}, async () => {
                    multicastSocket.send(
                        mJson,
                        0,
                        mJson.length,
                        multicastPort,
                        multicastAddress
                    );
                }, async () => {
                })
            }
            await sleepMsec(12000);
        }
    }
}

const randomIndex = (n: number): number => {
    return Math.floor(Math.random() * n);
}