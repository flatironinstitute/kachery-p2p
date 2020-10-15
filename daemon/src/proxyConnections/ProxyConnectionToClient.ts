import { action } from '../common/action';
import { getSignature, verifySignature } from '../common/crypto_util';
import DataStreamy from '../common/DataStreamy';
import GarbageMap from '../common/GarbageMap';
import { kacheryP2PDeserialize, kacheryP2PSerialize, randomAlphaString, sleepMsec } from '../common/util';
import { WebSocketInterface } from '../external/ExternalInterface';
import { elapsedSince, ErrorMessage, isEqualTo, isErrorMessage, isNodeId, isSignature, isString, isTimestamp, NodeId, nodeIdToPublicKey, nowTimestamp, RequestId, Signature, Timestamp, _validateObject } from "../interfaces/core";
import { isNodeToNodeRequest, isNodeToNodeResponse, isStreamId, NodeToNodeRequest, NodeToNodeResponse, StreamId } from '../interfaces/NodeToNodeRequest';
import KacheryP2PNode from '../KacheryP2PNode';
import { ByteCount, DurationMsec, durationMsec, durationMsecToNumber, isByteCount } from '../udp/UdpCongestionManager';

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
        body: isInitialMessageFromClientBody,
        signature: isSignature
    })
}

export interface ProxyStreamFileDataRequest {
    messageType: 'proxyStreamFileDataRequest',
    proxyStreamFileDataRequestId: ProxyStreamFileDataRequestId,
    streamId: StreamId
}
export const isProxyStreamFileDataRequest = (x: any): x is ProxyStreamFileDataRequest => {
    return _validateObject(x, {
        messageType: isEqualTo('proxyStreamFileDataRequest'),
        proxyStreamFileDataRequestId: isProxyStreamFileDataRequestId,
        streamId: isStreamId
    })
}

export interface ProxyStreamFileDataCancelRequest {
    messageType: 'proxyStreamFileDataCancelRequest',
    proxyStreamFileDataRequestId: ProxyStreamFileDataRequestId
}
export const isProxyStreamFileDataCancelRequest = (x: any): x is ProxyStreamFileDataCancelRequest => {
    return _validateObject(x, {
        messageType: isEqualTo('proxyStreamFileDataCancelRequest'),
        proxyStreamFileDataRequestId: isProxyStreamFileDataRequestId
    })
}

export const isBuffer = (x: any): x is Buffer => {
    return ((x !== null) && (x instanceof Buffer));
}

type ProxyStreamFileDataResponseMessageType = 'started' | 'data' | 'finished' | 'error'
const isProxyStreamFileDataResponseMessageType = (x: any): x is ProxyStreamFileDataResponseMessageType => {
    if (!isString(x)) return false;
    return [
        'started',
        'data',
        'finished',
        'error'
    ].includes(x)
}

export interface ProxyStreamFileDataResponseStartedMessage {
    proxyStreamFileDataRequestId: ProxyStreamFileDataRequestId,
    messageType: 'started',
    size: ByteCount
}
const isProxyStreamFileDataResponseStartedMessage = (x: any): x is ProxyStreamFileDataResponseStartedMessage => {
    return _validateObject(x, {
        proxyStreamFileDataRequestId: isProxyStreamFileDataRequestId,
        messageType: isEqualTo('started'),
        size: isByteCount
    })
}
export interface ProxyStreamFileDataResponseDataMessage {
    proxyStreamFileDataRequestId: ProxyStreamFileDataRequestId,
    messageType: 'data',
    data: Buffer
}
const isProxyStreamFileDataResponseDataMessage = (x: any): x is ProxyStreamFileDataResponseDataMessage => {
    return _validateObject(x, {
        proxyStreamFileDataRequestId: isProxyStreamFileDataRequestId,
        messageType: isProxyStreamFileDataResponseMessageType,
        data: isBuffer
    })
}
export interface ProxyStreamFileDataResponseFinishedMessage {
    proxyStreamFileDataRequestId: ProxyStreamFileDataRequestId,
    messageType: 'finished'
}
const isProxyStreamFileDataResponseFinishedMessage = (x: any): x is ProxyStreamFileDataResponseFinishedMessage => {
    return _validateObject(x, {
        proxyStreamFileDataRequestId: isProxyStreamFileDataRequestId,
        messageType: isProxyStreamFileDataResponseMessageType
    })
}
export interface ProxyStreamFileDataResponseErrorMessage {
    proxyStreamFileDataRequestId: ProxyStreamFileDataRequestId,
    messageType: 'error',
    errorMessage: ErrorMessage
}
const isProxyStreamFileDataResponseErrorMessage = (x: any): x is ProxyStreamFileDataResponseErrorMessage => {
    return _validateObject(x, {
        proxyStreamFileDataRequestId: isProxyStreamFileDataRequestId,
        messageType: isProxyStreamFileDataResponseMessageType,
        errorMessage: isErrorMessage
    })
}

type ProxyStreamFileDataResponseMessage =
        ProxyStreamFileDataResponseStartedMessage |
        ProxyStreamFileDataResponseDataMessage |
        ProxyStreamFileDataResponseFinishedMessage |
        ProxyStreamFileDataResponseErrorMessage
const isProxyStreamFileDataResponseMessage = (x: any): x is ProxyStreamFileDataResponseMessage => {
    return (
        isProxyStreamFileDataResponseStartedMessage(x) ||
        isProxyStreamFileDataResponseDataMessage(x) ||
        isProxyStreamFileDataResponseFinishedMessage(x) ||
        isProxyStreamFileDataResponseErrorMessage(x)
    )
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

export type MessageFromClient = NodeToNodeResponse | ProxyStreamFileDataResponseMessage
export const isMessageFromClient = (x: any): x is MessageFromClient => {
    return isNodeToNodeResponse(x) || isProxyStreamFileDataResponseMessage(x)
}
export type MessageFromServer = NodeToNodeRequest | ProxyStreamFileDataRequest | ProxyStreamFileDataCancelRequest // | others...
export const isMessageFromServer = (x: any): x is MessageFromServer => {
    return isNodeToNodeRequest(x) || isProxyStreamFileDataRequest(x) || isProxyStreamFileDataCancelRequest(x)
}

export interface ProxyStreamFileDataRequestId extends String {
    __proxyStreamFileDataRequestId__: never // phantom
}
export const isProxyStreamFileDataRequestId = (x: any): x is ProxyStreamFileDataRequestId => {
    if (!isString(x)) return false;
    return (/^[A-Za-z]{10}$/.test(x));
}
const createProxyStreamFileDataRequestId = () => {
    return randomAlphaString(10) as any as ProxyStreamFileDataRequestId
}

export class ProxyConnectionToClient {
    #node: KacheryP2PNode
    #remoteNodeId: NodeId | null = null
    #ws: WebSocketInterface
    #initialized = false
    #closed = false
    #onClosedCallbacks: ((reason: any) => void)[] = []
    #onInitializedCallbacks: (() => void)[] = []
    #responseListeners = new GarbageMap<RequestId, ((response: NodeToNodeResponse) => void)>(durationMsec(5 * 60 * 1000))
    #proxyStreamFileDataResponseMessageListeners = new GarbageMap<ProxyStreamFileDataRequestId, (msg: ProxyStreamFileDataResponseMessage) => void>(durationMsec(30 * 60 * 1000))
    constructor(node: KacheryP2PNode) {
        this.#node = node
    }
    async initialize(ws: WebSocketInterface) {
        return new Promise((resolve, reject) => {
            this.#ws = ws
            this.#ws.onClose((code, reason) => {
                /////////////////////////////////////////////////////////////////////////
                action('proxyConnectionToClientClosed', {context: "ProxyConnectionToClient", remoteNodeId: this.#remoteNodeId}, async () => {
                    this.#closed = true;
                    this.#onClosedCallbacks.forEach(cb => cb(reason));
                }, null);
                /////////////////////////////////////////////////////////////////////////
            })

            this.#ws.onError((err: Error) => {
                // this is important so we don't throw an exception
                // question: do we need to do something here? will 'close' be called also?
                console.warn(err)
            });
            this.onInitialized(() => {
                resolve();
            });
            this.onClosed((reason) => {
                if (!this.#initialized) {
                    reject(reason);
                }
            })
            ws.onMessage(messageBuffer => {
                if (this.#closed) return;
                /////////////////////////////////////////////////////////////////////////
                action('proxyConnectionToClientMessage', {context: "ProxyConnectionToClient", remoteNodeId: this.#remoteNodeId}, async () => {
                    if (!isBuffer(messageBuffer)) {
                        throw Error('Unexpected')
                    }
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
                /////////////////////////////////////////////////////////////////////////
            });
        });
    }
    async sendRequest(request: NodeToNodeRequest): Promise<NodeToNodeResponse> {
        this._sendMessageToClient(request);
        return await this._waitForResponse(request.body.requestId, {timeoutMsec: durationMsec(10000)});
    }
    streamFileData(streamId: StreamId): DataStreamy {
        // note: much of this code is duplicated from KacheryP2PNode.streamFileData

        const ret = new DataStreamy()

        const _handleResponseMessageFromServer = (msg: ProxyStreamFileDataResponseMessage) => {
            if (isProxyStreamFileDataResponseStartedMessage(msg)) {
                ret._start(msg.size)
            }
            else if (isProxyStreamFileDataResponseDataMessage(msg)) {
                ret._data(msg.data)
            }
            else if (isProxyStreamFileDataResponseFinishedMessage(msg)) {
                ret._end()
            }
            else if (isProxyStreamFileDataResponseErrorMessage(msg)) {
                ret._error(Error(msg.errorMessage.toString()))
            }
            else {
                throw Error('Unexpected')
            }
        }
        const proxyStreamFileDataRequestId = createProxyStreamFileDataRequestId()
        const request: ProxyStreamFileDataRequest = {
            messageType: 'proxyStreamFileDataRequest',
            proxyStreamFileDataRequestId,
            streamId
        }
        this.#proxyStreamFileDataResponseMessageListeners.set(proxyStreamFileDataRequestId, (msg) => {
            _handleResponseMessageFromServer(msg)
        })
        this._sendMessageToClient(request)
        ret._onCancel(() => {
            const cancelRequest: ProxyStreamFileDataCancelRequest = {
                messageType: 'proxyStreamFileDataCancelRequest',
                proxyStreamFileDataRequestId
            }
            this._sendMessageToClient(cancelRequest)
        })
        return ret
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
        else if (isProxyStreamFileDataResponseMessage(message)) {
            const a = this.#proxyStreamFileDataResponseMessageListeners.get(message.proxyStreamFileDataRequestId)
            if (a) {
                a(message)
            }
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
    async _waitForResponse(requestId: RequestId, {timeoutMsec}: {timeoutMsec: DurationMsec}): Promise<NodeToNodeResponse> {
        return new Promise((resolve, reject) => {
            let completed = false;
            this.#responseListeners.set(requestId, (response: NodeToNodeResponse) => {
                if (!completed) {
                    completed = true;
                    this.#responseListeners.delete(requestId);
                    resolve(response);
                }
            });
            (async () => {
                const timer = nowTimestamp()
                while (true) {
                    if (completed) return
                    if (this.#closed) {
                        reject(Error('Websocket closed while waiting for response'))
                        return
                    }
                    const elapsed = elapsedSince(timer)
                    if (elapsed >= durationMsecToNumber(timeoutMsec)) {
                        reject(Error('Timeout while waiting for response.'))
                        return
                    }
                    await sleepMsec(Math.min(800, durationMsecToNumber(timeoutMsec)))
                }
            })()
        });
    }
}