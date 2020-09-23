import assert from 'assert';
import RemoteNode from './RemoteNode.js';
import { JSONStringifyDeterministic } from './common/crypto_util';
import { sleepMsec } from './common/util';
import { validateChannelName, validateNodeToNodeMessage, validateNodeId, validateObject, validateNodeData, validatePort, validateSha1Hash } from './schema/index.js';
import KacheryP2PNode from './KacheryP2PNode.js';
import { ChannelInfo, ChannelName, NodeId } from './interfaces/core';
import { AnnounceRequestData, NodeToNodeRequest, NodeToNodeRequestData, NodeToNodeResponseData } from './interfaces/NodeToNodeRequest.js';

function str(x: any) {
    return x as string
}

class RemoteNodeManager {
    #node: KacheryP2PNode
    #remoteNodes: Map<NodeId, RemoteNode> = new Map<NodeId, RemoteNode>()
    #halted: boolean = false
    #localNodeInfo: Object | null = null // todo: type this
    #onMessageCallbacks: Function[]
    constructor(node: KacheryP2PNode) {
        this.#node = node;
        this._start();
    }
    halt() {
        this.#remoteNodes.forEach((remoteNode) => {
            remoteNode.halt();
        })
        this.#halted = true;
    }
    async handleAnnounceRequest({fromNodeId, requestData}: {fromNodeId: NodeId, requestData: AnnounceRequestData}) {
        // todo
    }
    async getChannelInfo(channelName: ChannelName): Promise<ChannelInfo> {
        // todo
        return {
            nodes: []
        }
    }
    async sendRequestToNode(nodeId: NodeId, requestData: NodeToNodeRequestData): Promise<NodeToNodeResponseData> {
        // todo: implement
        return {dummy: true} as any as NodeToNodeResponseData;
    }
    sendRequestToAllNodesInChannels(requestData: NodeToNodeRequestData, {timeoutMsec: number}) {
        // todo: implement
        const _cancel = () => {
            // todo
        }
        const onResponse = (callback: (nodeId: NodeId, responseData: NodeToNodeResponseData) => void) => {
            // todo
        }
        const onFinished = (callback: () => void) => {
            // todo
        }
        return {
            onResponse,
            onFinished,
            cancel: _cancel
        }
    }
    async _start() {
        // this._startCleanup();
    }
}

// function cloneObject(obj) {
//     if (!obj) return obj;
//     return JSON.parse(JSON.stringify(obj));
// }

export default RemoteNodeManager;