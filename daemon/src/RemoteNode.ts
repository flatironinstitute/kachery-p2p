import { getSignature, verifySignature } from "./common/crypto_util";
import { sleepMsec } from "./common/util";
import { httpPostJson } from "./httpPostJson";
import { Address, ChannelName, ChannelNodeInfo, createRequestId, NodeId, nodeIdToPublicKey, nowTimestamp } from "./interfaces/core";
import { isNodeToNodeResponse, NodeToNodeRequest, NodeToNodeRequestData, NodeToNodeResponseData } from "./interfaces/NodeToNodeRequest";
import KacheryP2PNode from "./KacheryP2PNode";

class RemoteNode {
    #node: KacheryP2PNode
    #halted: boolean = false;
    #remoteNodeId: NodeId
    #channelNodeInfoByChannel: Map<ChannelName, ChannelNodeInfo> = new Map<ChannelName, ChannelNodeInfo>()
    #isBootstrap: boolean
    #bootstrapAddress: Address | null
    constructor(node: KacheryP2PNode, remoteNodeId: NodeId, opts: {isBootstrap: boolean, bootstrapAddress: Address | null} = {isBootstrap: false, bootstrapAddress: null}) {
        this.#node = node
        this.#remoteNodeId = remoteNodeId;
        this.#isBootstrap = opts.isBootstrap
        this.#bootstrapAddress = opts.bootstrapAddress
        this._start();
    }
    remoteNodeId() {
        return this.#remoteNodeId;
    }
    isBootstrap() {
        return this.#isBootstrap
    }
    bootstrapAddress() {
        return this.#bootstrapAddress
    }
    setChannelNodeInfoIfMoreRecent(channelName: ChannelName, channelNodeInfo: ChannelNodeInfo) {
        if (this.#channelNodeInfoByChannel.has(channelName)) {
            const x = this.#channelNodeInfoByChannel.get(channelName);
            if (!x) throw Error('Unexpected.');
            if (x.body.timestamp > channelNodeInfo.body.timestamp) {
                // already have more recent
                return;
            }
        }
        this.#channelNodeInfoByChannel.set(channelName, channelNodeInfo);
    }
    getChannelNames() {
        let ret: ChannelName[] = [];
        this.#channelNodeInfoByChannel.forEach((channelNodeInfo, channelName) => {
            ret.push(channelName);
        });
        return ret;
    }
    getChannelNodeInfo(channelName: ChannelName): ChannelNodeInfo | null {
        return this.#channelNodeInfoByChannel.get(channelName) || null;
    }
    async sendRequest(requestData: NodeToNodeRequestData, opts: {timeoutMsec: number}): Promise<NodeToNodeResponseData> {
        let address: Address | null = null;
        if (this.#isBootstrap && this.#bootstrapAddress) {
            address = this.#bootstrapAddress
        }
        else {
            const channelNodeData = this._getMostRecentChannelNodeInfo();
            if (channelNodeData === null) {
                throw Error('Unable to send request to non-bootstrap node: no channel node data found.');
            }
            const remoteInfo = channelNodeData.body;
            if (remoteInfo.httpAddress) {
                address = remoteInfo.httpAddress;
            }
            else {
                if (remoteInfo.proxyHttpAddresses.length > 0) {
                    address = remoteInfo.proxyHttpAddresses[0];
                }
            }
            if (!address) {
                throw Error('Unable to send request... no http address found.')
            }
        }
        const requestId = createRequestId();
        const requestBody = {
            requestId,
            fromNodeId: this.#node.nodeId(),
            toNodeId: this.#remoteNodeId,
            timestamp: nowTimestamp(),
            requestData
        }
        const request: NodeToNodeRequest = {
            body: requestBody,
            signature: getSignature(requestBody, this.#node.keyPair())
        }
        const response = await httpPostJson(address, '/NodeToNodeRequest', request, {timeoutMsec: opts.timeoutMsec});
        if (!isNodeToNodeResponse(response)) {
            // todo: in this situation, do we ban the node?
            throw Error('Invalid response from node.');
        }
        if (response.body.responseData.requestType !== request.body.requestData.requestType) {
            throw Error('Unexpected requestType in response.')
        }
        if (response.body.fromNodeId !== this.#remoteNodeId) {
            throw Error('Unexpected fromNodeId in response.')
        }
        if (response.body.toNodeId !== this.#node.nodeId()) {
            throw Error('Unexpected toNodeId in response.')
        }
        if (response.body.requestId !== requestId) {
            throw Error('Unexpected requestId in response.')
        }
        if (Number(response.body.timestamp) < Number(request.body.timestamp) - 1000) {
            throw Error('Unexpected early timestamp in response.')
        }
        if (!verifySignature(response.body, response.signature, nodeIdToPublicKey(this.#remoteNodeId))) {
            // todo: in this situation, do we ban the node?
            throw Error('Invalid signature in response.');
        }
        return response.body.responseData;
    }
    halt() {
        this.#halted = true;
    }
    _getMostRecentChannelNodeInfo(): ChannelNodeInfo | null {
        let result: ChannelNodeInfo | null = null;
        this.#channelNodeInfoByChannel.forEach((channelNodeInfo, channelName) => {
            if ((result === null) || (channelNodeInfo.body.timestamp > result.body.timestamp)) {
                result = channelNodeInfo;
            }
        })
        return result;
    }
    async _start() {
        while (!this.#halted) {
            await sleepMsec(10000);
        }
    }
}

export default RemoteNode;