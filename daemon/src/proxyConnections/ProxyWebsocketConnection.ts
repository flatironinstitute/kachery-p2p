import { action } from '../common/action';
import { getSignature, verifySignature } from '../common/crypto_util';
import DataStreamy from '../common/DataStreamy';
import GarbageMap from '../common/GarbageMap';
import { kacheryP2PDeserialize, kacheryP2PSerialize, randomAlphaString, sleepMsec } from '../common/util';
import { WebSocketInterface } from '../external/ExternalInterface';
import { Address, byteCount, ByteCount, DurationMsec, durationMsecToNumber, elapsedSince, ErrorMessage, errorMessage, isBuffer, isByteCount, isEqualTo, isErrorMessage, isNodeId, isSignature, isString, isTimestamp, minDuration, NodeId, nodeIdToPublicKey, nowTimestamp, RequestId, scaledDurationMsec, Signature, Timestamp, _validateObject } from "../interfaces/core";
import { isNodeToNodeRequest, isNodeToNodeResponse, isStreamId, NodeToNodeRequest, NodeToNodeResponse, StreamId } from "../interfaces/NodeToNodeRequest";
import KacheryP2PNode from '../KacheryP2PNode';

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

export type MessageFromClient = NodeToNodeRequest | NodeToNodeResponse | ProxyStreamFileDataResponseMessage
export const isMessageFromClient = (x: any): x is MessageFromClient => {
    return isNodeToNodeRequest(x) || isNodeToNodeResponse(x) || isProxyStreamFileDataResponseMessage(x)
}
export type MessageFromServer = NodeToNodeRequest | NodeToNodeResponse | ProxyStreamFileDataRequest | ProxyStreamFileDataCancelRequest // | others...
export const isMessageFromServer = (x: any): x is MessageFromServer => {
    return isNodeToNodeRequest(x) || isNodeToNodeResponse(x) || isProxyStreamFileDataRequest(x) || isProxyStreamFileDataCancelRequest(x)
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

export class ProxyWebsocketConnection {
    #node: KacheryP2PNode
    #remoteNodeId: NodeId | null = null
    #ws: WebSocketInterface
    #initialized = false
    #closed = false
    #onClosedCallbacks: ((reason: any) => void)[] = []
    #onInitializedCallbacks: (() => void)[] = []
    #proxyStreamFileDataCancelCallbacks = new GarbageMap<ProxyStreamFileDataRequestId, () => void>(scaledDurationMsec(30 * 60 * 1000))
    #responseListeners = new GarbageMap<RequestId, ((response: NodeToNodeResponse) => void)>(scaledDurationMsec(5 * 60 * 1000))
    #proxyStreamFileDataResponseMessageListeners = new GarbageMap<ProxyStreamFileDataRequestId, (msg: ProxyStreamFileDataResponseMessage) => void>(scaledDurationMsec(30 * 60 * 1000))
    constructor(node: KacheryP2PNode, private opts: {connectionType: 'connectionToClient' | 'connectionToServer', isMessageProxy: boolean, isDataProxy: boolean}) {
        this.#node = node
    }
    async initializeConnectionToServer(remoteNodeId: NodeId, address: Address, opts: {timeoutMsec: DurationMsec}) {
        if (this.opts.connectionType !== 'connectionToServer') {
            throw Error('Unexpected in initializeConnectionToServer')
        }
        this.#remoteNodeId = remoteNodeId;
        if (!address.hostName) throw Error('Unexpected in initializeConnectionToServer')
        return new Promise<void>((resolve, reject) => {
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
                if (!isBuffer(messageBuffer)) throw Error('Unexpected message buffer in proxyConnectionToServerMessage')
                this.#node.stats().reportBytesReceived('webSocket', this.#remoteNodeId, byteCount(messageBuffer.length))
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
                            /* istanbul ignore next */
                            console.warn(`Invalid initial websocket message from server. Closing.`)
                            /* istanbul ignore next */
                            this.#ws.close()
                            /* istanbul ignore next */
                            return
                        }
                        if (messageParsed.body.toNodeId !== this.#node.nodeId()) {
                            /* istanbul ignore next */
                            console.warn(`Invalid initial websocket message from server (wrong toNodeId). Closing.`)
                            /* istanbul ignore next */
                            this.#ws.close()
                            /* istanbul ignore next */
                            return
                        }
                        if (messageParsed.body.fromNodeId === this.#node.nodeId()) {
                            /* istanbul ignore next */
                            console.warn(`Invalid initial websocket message from server (invalid fromNodeId). Closing.`)
                            /* istanbul ignore next */
                            this.#ws.close()
                            /* istanbul ignore next */
                            return
                        }
                        if (!verifySignature(messageParsed.body, messageParsed.signature, nodeIdToPublicKey(messageParsed.body.fromNodeId))) {
                            /* istanbul ignore next */
                            console.warn(`Invalid initial websocket message from server (invalid signature). Closing.`)
                            /* istanbul ignore next */
                            this.#ws.close()
                            /* istanbul ignore next */
                            return
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
                            /* istanbul ignore next */
                            this.#ws.close();
                            /* istanbul ignore next */
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
    async initializeConnectionToClient(ws: WebSocketInterface) {
        if (this.opts.connectionType !== 'connectionToClient') {
            throw Error('Unexpected type in initializeConnectionToClient')
        }
        return new Promise<void>((resolve, reject) => {
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
                /* istanbul ignore next */
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
                if (this.#closed) return
                if (!isBuffer(messageBuffer)) throw Error('Unexpected message buffer in proxyConnectionToClientMessage')
                this.#node.stats().reportBytesReceived('webSocket', this.#remoteNodeId, byteCount(messageBuffer.length))
                /////////////////////////////////////////////////////////////////////////
                action('proxyConnectionToClientMessage', {context: "ProxyConnectionToClient", remoteNodeId: this.#remoteNodeId}, async () => {
                    /* istanbul ignore next */
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
                            /* istanbul ignore next */
                            {
                                console.warn(`Invalid initial websocket message from client. Closing.`)
                                this.#ws.close()
                                return
                            }
                        }
                        if (messageParsed.body.toNodeId !== this.#node.nodeId()) {
                            /* istanbul ignore next */
                            {
                                console.warn(`Invalid initial websocket message from client (wrong toNodeId) (${messageParsed.body.toNodeId} <> ${this.#node.nodeId()}). Closing.`)
                                this.#ws.close()
                                return
                            }
                        }
                        if (messageParsed.body.fromNodeId === this.#node.nodeId()) {
                            /* istanbul ignore next */
                            {
                                console.warn(`Invalid initial websocket message from client (invalid fromNodeId). Closing.`)
                                this.#ws.close()
                                return
                            }
                        }
                        if (!verifySignature(messageParsed.body, messageParsed.signature, nodeIdToPublicKey(messageParsed.body.fromNodeId))) {
                            /* istanbul ignore next */
                            {
                                console.warn(`Invalid initial websocket message from client (invalid signature). Closing.`)
                                this.#ws.close()
                                return
                            }
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
                        const messageSerialized = kacheryP2PSerialize(msg)
                        this.#node.stats().reportBytesSent('webSocket', this.#remoteNodeId, byteCount(messageSerialized.length))
                        this.#ws.send(messageSerialized)
                        this.#onInitializedCallbacks.forEach(cb => {cb()});
                    }
                    else {
                        if (!this.#remoteNodeId) throw Error('Unexpected.');
                        if (!isMessageFromClient(messageParsed)) {
                            /* istanbul ignore next */
                            {
                                console.warn(`Invalid websocket message from client. Closing.`)
                                this.#ws.close()
                                return
                            }
                        }
                        this._handleMessageFromClient(messageParsed);
                    }
                }, null);
                /////////////////////////////////////////////////////////////////////////
            });
        });
    }
    isMessageProxy() {
        return this.opts.isMessageProxy
    }
    isDataProxy() {
        return this.opts.isDataProxy
    }
    streamFileData(streamId: StreamId): DataStreamy {
        if (this.opts.connectionType !== 'connectionToClient') {
            throw Error('Unexpected type in streamFileData')
        }
        const ret = new DataStreamy()

        const _handleResponseMessageFromServer = (msg: ProxyStreamFileDataResponseMessage) => {
            if (isProxyStreamFileDataResponseStartedMessage(msg)) {
                ret.producer().start(msg.size)
            }
            else if (isProxyStreamFileDataResponseDataMessage(msg)) {
                ret.producer().data(msg.data)
            }
            else if (isProxyStreamFileDataResponseFinishedMessage(msg)) {
                ret.producer().end()
            }
            else if (isProxyStreamFileDataResponseErrorMessage(msg)) {
                ret.producer().error(Error(msg.errorMessage.toString()))
            }
            else {
                /* istanbul ignore next */
                throw Error('Unexpected in _handleResponseMessageFromServer')
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
        this._sendMessageToRemote(request)
        ret.producer().onCancelled(() => {
            const cancelRequest: ProxyStreamFileDataCancelRequest = {
                messageType: 'proxyStreamFileDataCancelRequest',
                proxyStreamFileDataRequestId
            }
            this._sendMessageToRemote(cancelRequest)
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
    async sendRequest(request: NodeToNodeRequest, opts: {timeoutMsec: DurationMsec}): Promise<NodeToNodeResponse> {
        this._sendMessageToRemote(request);
        return await this._waitForResponse(request.body.requestId, {timeoutMsec: opts.timeoutMsec, requestType: request.body.requestData.requestType});
    }
    remoteNodeId(): NodeId {
        if (!this.#remoteNodeId) {
            /* istanbul ignore next */
            throw Error('Unexpected. remoteNodeId() called before initialized.');
        }
        return this.#remoteNodeId
    }
    async _handleMessageFromServer(message: MessageFromServer) {
        if (this.opts.connectionType !== 'connectionToServer') throw Error('Unexpected type in _handleMessageFromServer')
        if (this.#closed) return;
        if (isNodeToNodeRequest(message)) {
            const response = await this.#node.handleNodeToNodeRequest(message);
            this._sendMessageToRemote(response);
        }
        else if (isNodeToNodeResponse(message)) {
            const callback = this.#responseListeners.get(message.body.requestId);
            if (!callback) {
                // must have timed out
                return;
            }
            callback(message);
        }
        else if (isProxyStreamFileDataRequest(message)) {
            await this._handleProxyStreamFileDataRequest(message)
        }
        else if (isProxyStreamFileDataCancelRequest(message)) {
            await this._handleProxyStreamFileDataCancelRequest(message)
        }
        else {
            throw Error('Unexpected message from server')
        }
    }
    async _handleMessageFromClient(message: MessageFromClient) {
        if (this.opts.connectionType !== 'connectionToClient') throw Error('Unexpected type in _handleMessageFromClient')
        if (this.#closed) return;
        if (isNodeToNodeRequest(message)) {
            const response = await this.#node.handleNodeToNodeRequest(message);
            this._sendMessageToRemote(response);
        }
        else if (isNodeToNodeResponse(message)) {
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
            /* istanbul ignore next */
            throw Error('Unexpected message from client')
        }
    }
    async _handleProxyStreamFileDataRequest(request: ProxyStreamFileDataRequest) {
        if (this.opts.connectionType !== 'connectionToServer') throw Error('Unexpected type in _handleProxyStreamFileDataRequest')
        // the server is requesting to stream file data up from the client
        const {streamId} = request
        const s = await this.#node.streamFileData(this.#node.nodeId(), streamId)
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
            this._sendMessageToRemote(response)
        })
        s.onData(data => {
            const response: ProxyStreamFileDataResponseDataMessage = {
                messageType: 'data',
                proxyStreamFileDataRequestId: request.proxyStreamFileDataRequestId,
                data
            }
            this._sendMessageToRemote(response)
        })
        s.onFinished(() => {
            const response: ProxyStreamFileDataResponseFinishedMessage = {
                messageType: 'finished',
                proxyStreamFileDataRequestId: request.proxyStreamFileDataRequestId
            }
            this._sendMessageToRemote(response)
        })
        s.onError((err: Error) => {
            const response: ProxyStreamFileDataResponseErrorMessage = {
                messageType: 'error',
                proxyStreamFileDataRequestId: request.proxyStreamFileDataRequestId,
                errorMessage: errorMessage(err.message)
            }
            this._sendMessageToRemote(response)
        })
        this.#proxyStreamFileDataCancelCallbacks.set(request.proxyStreamFileDataRequestId, () => {s.cancel()})
    }
    async _handleProxyStreamFileDataCancelRequest(request: ProxyStreamFileDataCancelRequest) {
        if (this.opts.connectionType !== 'connectionToServer') throw Error('Unexpected type in _handleProxyStreamFileDataCancelRequest')
        const cb = this.#proxyStreamFileDataCancelCallbacks.get(request.proxyStreamFileDataRequestId)
        if (cb) cb()
    }
    _sendMessageToRemote(msg: MessageFromClient | MessageFromServer) {
        if (!this.#initialized) {
            /* istanbul ignore next */
            throw Error('Cannot send message over websocket before initialized.')
        }
        if (this.#closed) return;
        const messageSerialized = kacheryP2PSerialize(msg)
        this.#node.stats().reportBytesSent('webSocket', this.#remoteNodeId, byteCount(messageSerialized.length))
        this.#ws.send(messageSerialized)
    }
    async _waitForResponse(requestId: RequestId, {timeoutMsec, requestType}: {timeoutMsec: DurationMsec, requestType: string}): Promise<NodeToNodeResponse> {
        return new Promise<NodeToNodeResponse>((resolve, reject) => {
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
                        /* istanbul ignore next */
                        {
                            reject(Error('Websocket closed while waiting for response'))
                            return
                        }
                    }
                    const elapsed = elapsedSince(timer)
                    if (elapsed >= durationMsecToNumber(timeoutMsec)) {
                        reject(Error(`Timeout while waiting for ${requestType} response in proxy connection to client.`))
                        return
                    }
                    await sleepMsec(minDuration(scaledDurationMsec(800), timeoutMsec))
                }
            })()
        });
    }
}