import { action } from '../common/action';
import { getSignature, verifySignature } from '../common/crypto_util';
import GarbageMap from '../common/GarbageMap';
import { kacheryP2PDeserialize, kacheryP2PSerialize } from '../common/util';
import { WebSocketInterface } from '../external/ExternalInterface';
import { Address, byteCount, DurationMsec, errorMessage, NodeId, nodeIdToPublicKey, nowTimestamp, scaledDurationMsec } from "../interfaces/core";
import { isNodeToNodeRequest } from "../interfaces/NodeToNodeRequest";
import KacheryP2PNode from '../KacheryP2PNode';
import { InitialMessageFromClient, InitialMessageFromClientBody, isInitialMessageFromServer, isMessageFromServer, isProxyStreamFileDataCancelRequest, isProxyStreamFileDataRequest, MessageFromClient, MessageFromServer, ProxyStreamFileDataCancelRequest, ProxyStreamFileDataRequest, ProxyStreamFileDataRequestId, ProxyStreamFileDataResponseDataMessage, ProxyStreamFileDataResponseErrorMessage, ProxyStreamFileDataResponseFinishedMessage, ProxyStreamFileDataResponseStartedMessage } from './ProxyConnectionToClient';

export class ProxyConnectionToServer {
    #node: KacheryP2PNode
    #remoteNodeId: NodeId | null = null
    #ws: WebSocketInterface
    #initialized = false
    #closed = false
    #onClosedCallbacks: ((reason: any) => void)[] = []
    #onInitializedCallbacks: (() => void)[] = []
    #proxyStreamFileDataCancelCallbacks = new GarbageMap<ProxyStreamFileDataRequestId, () => void>(scaledDurationMsec(30 * 60 * 1000))
    constructor(node: KacheryP2PNode) {
        this.#node = node
    }
    async initialize(remoteNodeId: NodeId, address: Address, opts: {timeoutMsec: DurationMsec}) {
        this.#remoteNodeId = remoteNodeId;
        return new Promise((resolve, reject) => {
            const url = `ws://${address.hostName}:${address.port}`;
            this.#ws = this.#node.externalInterface().createWebSocket(url, {timeoutMsec: opts.timeoutMsec})
            this.#ws.onClose((code, reason) => {
                this.#closed = true;
                this.#onClosedCallbacks.forEach(cb => cb(reason));
            })
            this.#ws.onError(err => {
                /* istanbul ignore next */
                console.warn(err)
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
            const msgBody: InitialMessageFromClientBody = {
                type: 'proxyConnectionInitialMessageFromClient',
                fromNodeId: this.#node.nodeId(),
                toNodeId: remoteNodeId,
                timestamp: nowTimestamp()
            }
            const msg: InitialMessageFromClient = {
                body: msgBody,
                signature: getSignature(msgBody, this.#node.keyPair())
            }
            this.#ws.onOpen(() => {
                const messageSerialized = kacheryP2PSerialize(msg)
                this.#node.stats().reportBytesSent('webSocket', this.#remoteNodeId, byteCount(messageSerialized.length))
                this.#ws.send(messageSerialized);
            })
            this.#ws.onMessage(messageBuffer => {
                if (this.#closed) return;
                /////////////////////////////////////////////////////////////////////////
                action('proxyConnectionToServerMessage', {context: "ProxyConnectionToServer", remoteNodeId: this.#remoteNodeId}, async () => {
                    let messageParsed: Object;
                    try {
                        messageParsed = kacheryP2PDeserialize(messageBuffer);
                    }
                    catch(err) {
                        this.#ws.close();
                        return;
                    }
                    if (!this.#initialized) {
                        if (!isInitialMessageFromServer(messageParsed)) {
                            console.warn(`Invalid initial websocket message from server. Closing.`);
                            this.#ws.close();
                            return;
                        }
                        if (messageParsed.body.toNodeId !== this.#node.nodeId()) {
                            console.warn(`Invalid initial websocket message from server (wrong toNodeId). Closing.`);
                            this.#ws.close();
                            return;
                        }
                        if (messageParsed.body.fromNodeId === this.#node.nodeId()) {
                            console.warn(`Invalid initial websocket message from server (invalid fromNodeId). Closing.`);
                            this.#ws.close();
                            return;
                        }
                        if (!verifySignature(messageParsed.body, messageParsed.signature, nodeIdToPublicKey(messageParsed.body.fromNodeId))) {
                            console.warn(`Invalid initial websocket message from server (invalid signature). Closing.`);
                            this.#ws.close();
                            return;
                        }
                        this.#initialized = true;
                        this.#onInitializedCallbacks.forEach(cb => {cb()});
                    }
                    else {
                        if (!this.#remoteNodeId) {
                            /* istanbul ignore next */
                            throw Error('Unexpected.')
                        }
                        if (!isMessageFromServer(messageParsed)) {
                            /* istanbul ignore next */
                            console.warn(`Invalid websocket message from server. Closing.`);
                            this.#ws.close();
                            return;
                        }
                        this._handleMessageFromServer(messageParsed);
                    }
                }, async () => {
                    //
                })
                /////////////////////////////////////////////////////////////////////////
            });
        });
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
    // remoteNodeId(): NodeId {
    //     if (!this.#remoteNodeId) {
    //         /* istanbul ignore next */
    //         throw Error('Unexpected. remoteNodeId() called before initialized.');
    //     }
    //     return this.#remoteNodeId
    // }
    async _handleMessageFromServer(message: MessageFromServer) {
        if (this.#closed) return;
        if (isNodeToNodeRequest(message)) {
            const response = await this.#node.handleNodeToNodeRequest(message);
            this._sendMessageToServer(response);
        }
        else if (isProxyStreamFileDataRequest(message)) {
            this._handleProxyStreamFileDataRequest(message)
        }
        else if (isProxyStreamFileDataCancelRequest(message)) {
            this._handleProxyStreamFileDataCancelRequest(message)
        }
        else {
            throw Error('Unexpected message from server')
        }
    }
    _handleProxyStreamFileDataRequest(request: ProxyStreamFileDataRequest) {
        // the server is requesting to stream file data up from the client
        const {streamId} = request
        const s = this.#node.streamFileData(this.#node.nodeId(), streamId)
        s.onStarted(size => {
            if (size === null) {
                /* istanbul ignore next */
                throw Error('unexpected.')
            }
            const response: ProxyStreamFileDataResponseStartedMessage = {
                messageType: 'started',
                proxyStreamFileDataRequestId: request.proxyStreamFileDataRequestId,
                size
            }
            this._sendMessageToServer(response)
        })
        s.onData(data => {
            const response: ProxyStreamFileDataResponseDataMessage = {
                messageType: 'data',
                proxyStreamFileDataRequestId: request.proxyStreamFileDataRequestId,
                data
            }
            this._sendMessageToServer(response)
        })
        s.onFinished(() => {
            const response: ProxyStreamFileDataResponseFinishedMessage = {
                messageType: 'finished',
                proxyStreamFileDataRequestId: request.proxyStreamFileDataRequestId
            }
            this._sendMessageToServer(response)
        })
        s.onError((err: Error) => {
            const response: ProxyStreamFileDataResponseErrorMessage = {
                messageType: 'error',
                proxyStreamFileDataRequestId: request.proxyStreamFileDataRequestId,
                errorMessage: errorMessage(err.message)
            }
            this._sendMessageToServer(response)
        })
        this.#proxyStreamFileDataCancelCallbacks.set(request.proxyStreamFileDataRequestId, () => {s.cancel()})
    }
    _handleProxyStreamFileDataCancelRequest(request: ProxyStreamFileDataCancelRequest) {
        const cb = this.#proxyStreamFileDataCancelCallbacks.get(request.proxyStreamFileDataRequestId)
        if (cb) cb()
    }
    _sendMessageToServer(msg: MessageFromClient) {
        if (!this.#initialized) {
            /* istanbul ignore next */
            throw Error('Cannot send message to server before initialized.');
        }
        if (this.#closed) return;
        const messageSerialized = kacheryP2PSerialize(msg)
        this.#node.stats().reportBytesSent('webSocket', this.#remoteNodeId, byteCount(messageSerialized.length))
        this.#ws.send(messageSerialized)
    }
}