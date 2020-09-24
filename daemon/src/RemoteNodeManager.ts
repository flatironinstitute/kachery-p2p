import RemoteNode from './RemoteNode.js';
import { verifySignature } from './common/crypto_util';
import KacheryP2PNode from './KacheryP2PNode.js';
import { ChannelInfo, ChannelName, ChannelNodeInfo, NodeId, nodeIdToPublicKey } from './interfaces/core';
import { AnnounceRequestData, AnnounceResponseData, isDownloadRequest, NodeToNodeRequestData, NodeToNodeResponseData } from './interfaces/NodeToNodeRequest.js';

class RemoteNodeManager {
    #node: KacheryP2PNode
    #remoteNodes: Map<NodeId, RemoteNode> = new Map<NodeId, RemoteNode>()
    #halted: boolean = false
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
    async handleAnnounceRequest({fromNodeId, requestData}: {fromNodeId: NodeId, requestData: AnnounceRequestData}): Promise<AnnounceResponseData> {
        // todo: only handle this if we belong to this channel or we are a bootstrap node
        const { channelNodeInfo } = requestData;
        const { body, signature } = channelNodeInfo;
        if (!verifySignature(body, signature, nodeIdToPublicKey(channelNodeInfo.body.nodeId))) {
            throw Error('Invalid signature for channelNodeInfo.');
        }
        if (!this.#remoteNodes.has(body.nodeId)) {
            this.#remoteNodes.set(body.nodeId, new RemoteNode(this.#node, body.nodeId));
        }
        const n = this.#remoteNodes.get(body.nodeId);
        if (!n) throw Error('Unexpected');
        n.setChannelNodeInfoIfMoreRecent(channelNodeInfo.body.channelName, channelNodeInfo);
        return {
            requestType: 'announce'
        }
    }
    async getChannelInfo(channelName: ChannelName): Promise<ChannelInfo> {
        const nodes: ChannelNodeInfo[] = [];
        this.#remoteNodes.forEach(n => {
            const cni = n.getChannelNodeInfo(channelName);
            if (cni !== null) {
                nodes.push(cni);
            }
        })
        return {
            nodes
        }
    }
    async sendRequestToNode(nodeId: NodeId, requestData: NodeToNodeRequestData): Promise<NodeToNodeResponseData> {
        if (isDownloadRequest(requestData)) {
            throw Error('Unexpected, request is a download request.');
        }
        const remoteNode = this.#remoteNodes.get(nodeId);
        if (!remoteNode) {
            throw Error(`Cannot send request to node: node with ID ${nodeId} not found.`)
        }
        return await remoteNode.sendRequest(requestData);
    }
    sendDownloadRequestToNode(nodeId: NodeId, requestData: NodeToNodeRequestData) {
        if (!isDownloadRequest(requestData)) {
            throw Error('Unexpected, request is not a download request.');
        }
        // todo: implement
        const _onDataCallbacks: ((data: Buffer) => void)[] = [];
        const _onFinishedCallbacks: (() => void)[] = [];
        const _onErrorCallbacks: ((err: Error) => void)[] = [];
        const _cancel = () => {
            // todo
        }
        return {
            onData: (callback: (data: Buffer) => void) => {_onDataCallbacks.push(callback)},
            onFinished: (callback: () => void) => {_onFinishedCallbacks.push(callback)},
            onError: (callback: (err: Error) => void) => {_onErrorCallbacks.push(callback)},
            cancel: _cancel
        }
    }
    sendRequestToNodesInChannels(requestData: NodeToNodeRequestData, opts: {timeoutMsec: number, channelNames: ChannelName[]}) {
        if (isDownloadRequest(requestData)) {
            throw Error('Unexpected, request is a download request.');
        }
        let finished = false;
        const _onResponseCallbacks: ((nodeId: NodeId, responseData: NodeToNodeResponseData) => void)[] = [];
        const _onFinishedCallbacks: (() => void)[] = [];
        const promises: (Promise<NodeToNodeResponseData>)[] = [];
        this.#remoteNodes.forEach(n => {
            const nodeChannelNames = n.getChannelNames();
            let okay = false;
            opts.channelNames.forEach(channelName => {
                if (nodeChannelNames.includes(channelName)) {
                    okay = true;
                }
            })
            if (okay) {
                const promise = this.sendRequestToNode(n.remoteNodeId(), requestData);
                promise.then(responseData => {
                    if (finished) return;
                    _onResponseCallbacks.forEach(cb => {
                        cb(n.remoteNodeId(), responseData);
                    });
                })
                promises.push(promise);
            }
        });
        const _finalize = () => {
            if (!finished) {
                finished = true;
                _onFinishedCallbacks.forEach(cb => {cb()});
            }
        }
        const _cancel = () => {
            // todo - cancel the pending requests
            _finalize();
        }
        const onResponse = (callback: (nodeId: NodeId, responseData: NodeToNodeResponseData) => void) => {
            _onResponseCallbacks.push(callback);
        }
        const onFinished = (callback: () => void) => {
            _onFinishedCallbacks.push(callback);
        }
        setTimeout(() => {
            _cancel();
        }, opts.timeoutMsec);
        // the .map is required so that we wait until all are settled
        Promise.all(promises.map(p => p.catch(e => e))).finally(() => {
            _finalize();
        })
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