import WebSocket from 'ws'
import { action } from './action';
import { getSignature, verifySignature } from './common/crypto_util';
import GarbageMap from './common/GarbageMap';
import { kacheryP2PDeserialize, kacheryP2PSerialize } from './common/util';
import { isEqualTo, isNodeId, isTimestamp, NodeId, Signature, isSignature, _validateObject, nodeIdToPublicKey, nowTimestamp, Timestamp, RequestId } from "./interfaces/core";
import { isNodeToNodeRequest, isNodeToNodeResponse, NodeToNodeRequest, NodeToNodeResponse } from "./interfaces/NodeToNodeRequest";
import KacheryP2PNode from './KacheryP2PNode';

export interface InitialMessageFromClientBody {
    type: 'proxyConnectionInitialMessageFromClient'
    fromNodeId: NodeId,
    toNodeId: NodeId,
    timestamp: Timestamp
}
export const isInitialMessageFromClientBody = (x: any): x is InitialMessageFromClientBody => {
    return _validateObject(x, {
        type: isEqualTo('proxyConnectionInitialMessageFromClient'),
        fromNodeId: isNodeId,
        toNodeId: isNodeId,
        timestamp: isTimestamp
    })
}
export interface InitialMessageFromClient {
    body: InitialMessageFromClientBody,
    signature: Signature
}
export const isInitialMessageFromClient = (x: any): x is InitialMessageFromClient => {
    return _validateObject(x, {
        body: isInitialMessageFromClient,
        signature: isSignature
    })
}

export interface InitialMessageFromServerBody {
    type: 'proxyConnectionInitialMessageFromServer',
    fromNodeId: NodeId,
    toNodeId: NodeId,
    timestamp: Timestamp
}
export const isInitialMessageFromServerBody = (x: any): x is InitialMessageFromServerBody => {
    return _validateObject(x, {
        type: isEqualTo('proxyConnectionInitialMessageFromServer'),
        fromNodeId: isNodeId,
        toNodeId: isNodeId,
        timestamp: isTimestamp
    })
}
export interface InitialMessageFromServer {
    body: InitialMessageFromServerBody,
    signature: Signature
}
export const isInitialMessageFromServer = (x: any): x is InitialMessageFromServer => {
    return _validateObject(x, {
        body: isInitialMessageFromServerBody,
        signature: isSignature
    })
}

export type MessageFromClient = NodeToNodeResponse; // | others...
export const isMessageFromClient = (x: any): x is MessageFromClient => {
    return isNodeToNodeResponse(x); // || others
}
export type MessageFromServer = NodeToNodeRequest; // | others...
export const isMessageFromServer = (x: any): x is MessageFromServer => {
    return isNodeToNodeRequest(x); // || others
}

export class ProxyConnectionToClient {
    #node: KacheryP2PNode
    #remoteNodeId: NodeId | null = null
    #ws: WebSocket
    #initialized = false
    #closed = false
    #onClosedCallbacks: ((reason: any) => void)[] = []
    #onInitializedCallbacks: (() => void)[] = []
    #responseListeners = new GarbageMap<RequestId, ((response: NodeToNodeResponse) => void)>(5 * 60 * 1000)
    constructor(node: KacheryP2PNode) {
        this.#node = node
    }
    async initialize(ws: WebSocket) {
        return new Promise((resolve, reject) => {
            this.#ws = ws
            this.#ws.on('close', (code, reason) => {
                action('proxyConnectionToClientClosed', {context: "ProxyConnectionToClient", remoteNodeId: this.#remoteNodeId}, async () => {
                    this.#closed = true;
                    this.#onClosedCallbacks.forEach(cb => cb(reason));
                }, null);
            })

            this.#ws.on('error', () => {
                // this is important so we don't throw an exception
                // question: do we need to do something here? will 'close' be called also?
            });
            this.onInitialized(() => {
                resolve();
            });
            this.onClosed((reason) => {
                if (!this.#initialized) {
                    reject(reason);
                }
            })
            ws.on('message', messageBuffer => {
                if (this.#closed) return;
                action('proxyConnectionToClientMessage', {context: "ProxyConnectionToClient", remoteNodeId: this.#remoteNodeId}, async () => {
                    let messageParsed: Object;
                    try {
                        messageParsed = kacheryP2PDeserialize(messageBuffer);
                    }
                    catch(err) {
                        this.#ws.close();
                        return;
                    }
                    if (!this.#initialized) {
                        if (!isInitialMessageFromClient(messageParsed)) {
                            console.warn(`Invalid initial websocket message from client. Closing.`);
                            this.#ws.close();
                            return;
                        }
                        if (messageParsed.body.toNodeId !== this.#node.nodeId()) {
                            console.warn(`Invalid initial websocket message from client (wrong toNodeId). Closing.`);
                            this.#ws.close();
                            return;
                        }
                        if (messageParsed.body.fromNodeId === this.#node.nodeId()) {
                            console.warn(`Invalid initial websocket message from client (invalid fromNodeId). Closing.`);
                            this.#ws.close();
                            return;
                        }
                        if (!verifySignature(messageParsed.body, messageParsed.signature, nodeIdToPublicKey(messageParsed.body.fromNodeId))) {
                            console.warn(`Invalid initial websocket message from client (invalid signature). Closing.`);
                            this.#ws.close();
                            return;
                        }
                        this.#initialized = true;
                        this.#remoteNodeId = messageParsed.body.fromNodeId
                        const msgBody: InitialMessageFromServerBody = {
                            type: 'proxyConnectionInitialMessageFromServer',
                            fromNodeId: this.#node.nodeId(),
                            toNodeId: this.#remoteNodeId,
                            timestamp: nowTimestamp()
                        }
                        const msg: InitialMessageFromServer = {
                            body: msgBody,
                            signature: getSignature(msgBody, this.#node.keyPair())
                        }
                        this.#ws.send(kacheryP2PSerialize(msg));
                        this.#onInitializedCallbacks.forEach(cb => {cb()});
                    }
                    else {
                        if (!this.#remoteNodeId) throw Error('Unexpected.');
                        if (!isMessageFromClient(messageParsed)) {
                            console.warn(`Invalid websocket message from client. Closing.`);
                            this.#ws.close();
                            return;
                        }
                        this._handleMessageFromClient(messageParsed);
                    }
                }, null);
            });
        });
    }
    async sendRequest(request: NodeToNodeRequest): Promise<NodeToNodeResponse> {
        this._sendMessageToClient(request);
        return await this._waitForResponse(request.body.requestId, {timeoutMsec: 10000});
    }
    onInitialized(callback: () => void) {
        this.#onInitializedCallbacks.push(callback);
    }
    close() {
        this.#ws.close();
    }
    onClosed(callback: (reason: any) => void) {
        this.#onClosedCallbacks.push(callback);
    }
    remoteNodeId(): NodeId {
        if (!this.#remoteNodeId) {
            throw Error('Unexpected. remoteNodeId() called before initialized.');
        }
        return this.#remoteNodeId
    }
    async _handleMessageFromClient(message: MessageFromClient) {
        if (this.#closed) return;
        if (isNodeToNodeResponse(message)) {
            const callback = this.#responseListeners.get(message.body.requestId);
            if (!callback) {
                // must have timed out
                return;
            }
            callback(message);
        }
        else {
            throw Error('Unexpected message from client')
        }
    }
    _sendMessageToClient(msg: MessageFromServer) {
        if (!this.#initialized) {
            throw Error('Cannot send message to client before initialized.');
        }
        if (this.#closed) return;
        this.#ws.send(kacheryP2PSerialize(msg));
    }
    async _waitForResponse(requestId: RequestId, {timeoutMsec}: {timeoutMsec: number}): Promise<NodeToNodeResponse> {
        return new Promise((resolve, reject) => {
            let completed = false;
            this.#responseListeners.set(requestId, (response: NodeToNodeResponse) => {
                if (!completed) {
                    completed = true;
                    this.#responseListeners.delete(requestId);
                    resolve(response);
                }
            });
            setTimeout(() => {
                if (!completed) {
                    completed = true;
                    this.#responseListeners.delete(requestId);
                    reject('Timeout while waiting for response.');
                }
            }, timeoutMsec);
        });
    }
}