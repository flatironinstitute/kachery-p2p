import dgram from 'dgram';
import { action } from "../common/action";
import { TIMEOUTS } from '../common/constants';
import { getSignature, verifySignature } from "../common/crypto_util";
import DataStreamy from '../common/DataStreamy';
import GarbageMap from "../common/GarbageMap";
import { RequestTimeoutError } from '../common/util';
import { DgramRemoteInfo, DgramSocket } from '../external/ExternalInterface';
import { Address, byteCount, DurationMsec, durationMsecToNumber, elapsedSince, errorMessage, ErrorMessage, hostName, isErrorMessage, isNodeId, isNumber, JSONObject, NodeId, nodeIdToPublicKey, nowTimestamp, Port, portToNumber, RequestId, scaledDurationMsec, toPort, tryParseJsonObject, _validateObject } from "../interfaces/core";
import { FallbackUdpPacketRequestData, isNodeToNodeRequest, isNodeToNodeResponse, isStreamId, NodeToNodeRequest, NodeToNodeResponse, StreamId } from "../interfaces/NodeToNodeRequest";
import { createUdpMessageId, isUdpHeader, numParts, NumParts, partIndex, PartIndex, UdpHeader, UdpMessageMetaData, udpMessageMetaData, UdpMessagePart, UdpMessageType, UDP_MESSAGE_HEADER_SIZE, UDP_PACKET_SIZE } from "../interfaces/UdpMessage";
import KacheryP2PNode from "../KacheryP2PNode";
import { protocolVersion } from "../protocolVersion";
import UdpMessagePartManager from '../udp/UdpMessagePartManager';
import UdpPacketReceiver from '../udp/UdpPacketReceiver';
import UdpPacketSender, { FallbackAddress, PacketId } from "../udp/UdpPacketSender";

interface ResponseListener {
    onResponse: (response: NodeToNodeResponse, header: UdpHeader) => void
}

interface DataListener {
    onData: (partIndex: PartIndex, numParts: NumParts, data: Buffer) => void,
    onFinished: () => void
}

interface StreamDataChunkMetaData {
    streamId: StreamId,
    dataChunkIndex: number
}
const isStreamDataChunkMetaData = (x: any): x is StreamDataChunkMetaData => {
    return _validateObject(x, {
        streamId: isStreamId,
        dataChunkIndex: isNumber
    })
}

export interface NodeIdFallbackAddress {
    nodeId: NodeId
}
export const isNodeIdFallbackAddress = (x: any): x is NodeIdFallbackAddress => {
    return _validateObject(x, {
        nodeId: isNodeId
    })
}
export const nodeIdFallbackAddress = (nodeId: NodeId): NodeIdFallbackAddress & FallbackAddress => {
    return {nodeId} as (NodeIdFallbackAddress & FallbackAddress)
}

interface StreamDataErrorMetaData {
    streamId: StreamId,
    errorMessage: ErrorMessage
}
const isStreamDataErrorMetaData = (x: any): x is StreamDataErrorMetaData => {
    return _validateObject(x, {
        streamId: isStreamId,
        errorMessage: isErrorMessage
    })
}

interface StreamDataEndMetaData {
    streamId: StreamId,
    numDataChunks: number
}
const isStreamDataEndMetaData = (x: any): x is StreamDataEndMetaData => {
    return _validateObject(x, {
        streamId: isStreamId,
        numDataChunks: isNumber
    })
}

export default class PublicUdpSocketServer {
    #node: KacheryP2PNode
    #messagePartManager = new UdpMessagePartManager()
    #socket: DgramSocket | null = null
    #udpPacketSender: UdpPacketSender | null = null
    #udpPacketReceiver: UdpPacketReceiver | null = null
    #responseListeners = new GarbageMap<RequestId, ResponseListener>(scaledDurationMsec(30 * 60 * 1000))
    #incomingDataStreams = new GarbageMap<StreamId, DataStreamy>(scaledDurationMsec(60 * 60 * 1000))
    #receivedUdpPackets = new GarbageMap<PacketId, boolean>(scaledDurationMsec(30 * 60 * 1000))
    #fallbackPacketSender: FallbackPacketSender
    #stopped = false
    constructor(node: KacheryP2PNode, private firewalled: boolean) {
        this.#node = node
        this.#messagePartManager.onMessageComplete((header, buffer) => {this._handleCompleteMessage(header, buffer)})
        this.#fallbackPacketSender = new FallbackPacketSender(this.#node)
    }
    stop() {
        this.#stopped = true
        if (this.#socket) {
            this.#socket.close()
        }
    }
    startListening(listenPort: Port) {
        return new Promise((resolve, reject) => {
            try {
                this.#socket = this.#node.externalInterface().dgramCreateSocket({ type: "udp4", reuseAddr: false, nodeId: this.#node.nodeId(), firewalled: this.firewalled })
                this.#socket.bind(portToNumber(listenPort))
                this.#socket.on("listening", () => {
                    /* istanbul ignore next */
                    if (this.#socket === null) throw Error('Unexpected')
                    this.#udpPacketSender = new UdpPacketSender(this.#socket, this.#fallbackPacketSender, this.#node.stats(), {thisNodeId: this.#node.nodeId()})
                    this.#udpPacketReceiver = new UdpPacketReceiver(this.#socket, () => (this.#node.getDefects()), this.#node.stats(), {thisNodeId: this.#node.nodeId()})
                    this.#udpPacketReceiver.onPacket((packetId: PacketId, packet: Buffer, remoteInfo: dgram.RemoteInfo) => {
                        this._receiveUdpPacket(packetId, packet, remoteInfo, null)
                    })
                    this.#udpPacketReceiver.onConfirmation((packetId) => {
                        /////////////////////////////////////////////////////////////////////////
                        action('confirmUdpPacket', {packetId}, async () => {
                            /* istanbul ignore next */
                            if (this.#udpPacketSender === null) throw Error('Unexpected')
                            this.#udpPacketSender.receivePacketConfirmation(packetId)
                        }, async () => {
                        })
                        /////////////////////////////////////////////////////////////////////////
                    })
                    resolve();
                });
            }
            catch(err) {
                reject(err);
            }
        });
    }
    async sendRequest(address: Address, request: NodeToNodeRequest, opts: {timeoutMsec: DurationMsec}): Promise<{response: NodeToNodeResponse, header: UdpHeader}> {
        const fallbackAddress: FallbackAddress = nodeIdFallbackAddress(request.body.toNodeId)
        return new Promise<{response: NodeToNodeResponse, header: UdpHeader}>((resolve, reject) => {
            let complete = false
            const _handleError = ((err: Error) => {
                if (complete) return
                complete = true
                if (this.#responseListeners.has(request.body.requestId)) {
                    this.#responseListeners.delete(request.body.requestId)
                }
                reject(err)
            })
            const _handleFinished = ((response: NodeToNodeResponse, header: UdpHeader) => {
                if (complete) return
                complete = true
                if (this.#responseListeners.has(request.body.requestId)) {
                    this.#responseListeners.delete(request.body.requestId)
                }
                resolve({response, header})
            })
            
            this.#responseListeners.set(request.body.requestId, {
                onResponse: (response: NodeToNodeResponse, header: UdpHeader) => {
                    _handleFinished(response, header)
                }
            })
            const timestamp = nowTimestamp()
            const checkTimeout = () => {
                if (complete) return
                const elapsed = elapsedSince(timestamp)
                if (elapsed > durationMsecToNumber(opts.timeoutMsec)) {
                    _handleError(new RequestTimeoutError(`Timeout waiting for response for request: ${request.body.requestData.requestType} (${elapsed} > ${opts.timeoutMsec} msec)`))
                }
                else {
                    setTimeout(() => {
                        checkTimeout()
                    }, durationMsecToNumber(scaledDurationMsec(500)))
                }
            }
            checkTimeout()
            this._sendMessage(
                address,
                fallbackAddress,
                "NodeToNodeRequest",
                request as any as JSONObject,
                udpMessageMetaData({}),
                {timeoutMsec: opts.timeoutMsec, toNodeId: request.body.toNodeId}
            ).catch(err => {
                _handleError(err)
            })
        })
    }
    getIncomingDataStream(streamId: StreamId): DataStreamy {
        if (this.#incomingDataStreams.has(streamId)) {
            /* istanbul ignore next */
            throw Error('Cannot get incoming data stream twice')
        }
        const ds = new DataStreamy()
        this.#incomingDataStreams.set(streamId, ds)
        ds.producer().onCancelled(() => {
            this._cancelIncomingDataStream(streamId)
        })
        return ds
    }
    setOutgoingDataStream(address: Address, fallbackAddress: FallbackAddress, streamId: StreamId, dataStream: DataStreamy, opts: {toNodeId: NodeId}) {
        let dataChunkIndex = 0
        dataStream.onFinished(() => {
            const metaData: StreamDataEndMetaData = {
                streamId,
                numDataChunks: dataChunkIndex
            }
            this._sendMessage(address, fallbackAddress, 'streamDataEnd', Buffer.alloc(0), udpMessageMetaData(metaData), {timeoutMsec: TIMEOUTS.defaultRequest, toNodeId: opts.toNodeId})
        })
        dataStream.onError((err: Error) => {
            const metaData: StreamDataErrorMetaData = {
                streamId,
                errorMessage: errorMessage(err.message)
            }
            this._sendMessage(address, fallbackAddress, 'streamDataError', Buffer.alloc(0), udpMessageMetaData(metaData), {timeoutMsec: TIMEOUTS.defaultRequest, toNodeId: opts.toNodeId})
        })
        dataStream.onData((dataChunk: Buffer) => {
            const metaData: StreamDataChunkMetaData = {
                streamId,
                dataChunkIndex
            }
            this._sendMessage(address, fallbackAddress, 'streamDataChunk', dataChunk, udpMessageMetaData(metaData), {timeoutMsec: TIMEOUTS.defaultRequest, toNodeId: opts.toNodeId})
            dataChunkIndex ++
        })
    }
    receiveFallbackUdpPacket(fromNodeId: NodeId, packetId: PacketId, packet: Buffer): void {
        this._receiveUdpPacket(packetId, packet, null, fromNodeId)
    }
    _cancelIncomingDataStream(streamId: StreamId) {
        const ds = this.#incomingDataStreams.get(streamId)
        if (!ds) return
    }
    _receiveUdpPacket(packetId: PacketId, packet: Buffer, remoteInfo: DgramRemoteInfo | null, checkFromNodeId: NodeId | null) {
        if (this.#receivedUdpPackets.has(packetId)) {
            return
        }
        this.#receivedUdpPackets.set(packetId, true)
        const fromAddress: Address | null = remoteInfo ? {
            port: toPort(remoteInfo.port),
            hostName: hostName(remoteInfo.address)
        } : null
        
        const headerTxt = packet.slice(0, UDP_MESSAGE_HEADER_SIZE).toString().trimEnd()
        const dataBuffer = packet.slice(UDP_MESSAGE_HEADER_SIZE);
        const header = tryParseJsonObject(headerTxt)
        if (header === null) {
            return;
        }
        if (!isUdpHeader(header)) {
            /* istanbul ignore next */
            console.warn(header)
            /* istanbul ignore next */
            console.warn('Problem with udp header')
            return
        }
        if (checkFromNodeId) {
            if (checkFromNodeId !== header.body.fromNodeId) {
                /* istanbul ignore next */
                console.warn('fromNodeId does not match in udp packet')
                /* istanbul ignore next */
                return
            }
        }

        if (remoteInfo !== null) {
            this.#node.stats().reportBytesReceived('udp', header.body.fromNodeId, byteCount(packet.length))
        }
        
        /////////////////////////////////////////////////////////////////////////
        action('handleUdpMessagePart', {fromAddress, fromNodeId: header.body.fromNodeId, udpMessageType: header.body.udpMessageType}, async () => {
            this._handleMessagePart(fromAddress, header, dataBuffer);
        }, async () => {
        })
        /////////////////////////////////////////////////////////////////////////
    }
    async _sendMessage(address: Address | null, fallbackAddress: FallbackAddress, messageType: UdpMessageType, messageData: Buffer | JSONObject, metaData: UdpMessageMetaData, opts: {timeoutMsec: DurationMsec, toNodeId: NodeId}): Promise<void> {
        if ((this.#socket === null) || (this.#udpPacketSender === null)) {
            /* istanbul ignore next */
            throw Error("Cannot _sendMessage before calling startListening()")
        }
        let payloadIsJson: boolean
        let messageBuffer: Buffer
        if (Buffer.isBuffer(messageData)) {
            payloadIsJson = false
            messageBuffer = messageData
        }
        else {
            payloadIsJson = true
            messageBuffer = Buffer.from(JSON.stringify(messageData))
        }
        const parts: UdpMessagePart[] = this._createUdpMessageParts(messageType, address, messageBuffer, metaData, {payloadIsJson})
        const packets: Buffer[] = []
        for (let part of parts) {
            const b = Buffer.concat([
                Buffer.from(JSON.stringify(part.header).padEnd(UDP_MESSAGE_HEADER_SIZE, ' ')),
                part.dataBuffer
            ])
            packets.push(b)
        }
        try {
            await this.#udpPacketSender.sendPackets(address, fallbackAddress, packets, {timeoutMsec: opts.timeoutMsec, toNodeId: opts.toNodeId})
        }
        catch(err) {
            if (this.#stopped) {
                // do not throw the error if stopped
                return
            }
            throw(err)
        }
    }
    _handleMessagePart(remoteAddress: Address | null, header: UdpHeader, dataBuffer: Buffer) {
        if (!verifySignature(header.body, header.signature, nodeIdToPublicKey(header.body.fromNodeId))) {
            /* istanbul ignore next */
            throw Error('Error verifying signature in udp message')
        }
        this.#messagePartManager.addMessagePart(remoteAddress, header.body.udpMessageId, header.body.partIndex, header.body.numParts, header, dataBuffer)
    }
    _handleCompleteMessage(header: UdpHeader, dataBuffer: Buffer) {
        const mt = header.body.udpMessageType
        if (mt === "NodeToNodeRequest") {
            const req = tryParseJsonObject(dataBuffer.toString())
            if (!isNodeToNodeRequest(req)) {
                // throw error? ban peer?
                /* istanbul ignore next */
                return
            }
            /////////////////////////////////////////////////////////////////////////
            action('/Udp/handleNodeToNodeRequest', {fromNodeId: req.body.fromNodeId, requestId: req.body.requestId, requestType: req.body.requestData.requestType}, async () => {
                const response: NodeToNodeResponse = await this.#node.handleNodeToNodeRequest(req)
                const fallbackAddress = nodeIdFallbackAddress(req.body.fromNodeId)
                const remoteAddress = this.#messagePartManager.getRemoteAddressForNodeId(req.body.fromNodeId)
                await this._sendMessage(remoteAddress, fallbackAddress, "NodeToNodeResponse", response as any as JSONObject, udpMessageMetaData({}), {timeoutMsec: TIMEOUTS.defaultResponse, toNodeId: req.body.fromNodeId})
            }, async () => {
            })
            /////////////////////////////////////////////////////////////////////////
        }
        else if (mt === "NodeToNodeResponse") {
            const res = tryParseJsonObject(dataBuffer.toString())
            if (!isNodeToNodeResponse(res)) {
                // throw error? ban peer?
                /* istanbul ignore next */
                return
            }
            /////////////////////////////////////////////////////////////////////////
            action('/Udp/handleNodeToNodeResponse', {fromNodeId: res.body.fromNodeId, requestId: res.body.requestId, requestType: res.body.responseData.requestType}, async () => {
                const responseListener = this.#responseListeners.get(res.body.requestId)
                if (responseListener) {
                    responseListener.onResponse(res, header)
                    // response listener will be delete that way we will not handle the same response twice
                }
                else {
                    // Do we need to warn here? Can this reasonably happen - like if we get two responses (maybe the first was lost?)
                    console.warn(`No response listener found for response: ${res.body.requestId} ${res.body.responseData.requestType}`)
                }
            }, async () => {                
            })
            /////////////////////////////////////////////////////////////////////////
        }
        else if (mt === "KeepAlive") {
            // todo
        }
        else if (mt === 'streamDataChunk') {
            const metaData = header.body.metaData
            if (!isStreamDataChunkMetaData(metaData)) {
                // do we want to throw error here? ban node?
                /* istanbul ignore next */
                throw Error('Invalid meta data for stream data chunk message')
            }
            const ds = this.#incomingDataStreams.get(metaData.streamId)
            if (!ds) {
                // do we want to throw error here?
                /* istanbul ignore next */
                throw Error('No incoming data stream found for data chunk message')
            }
            ds.producer().unorderedData(metaData.dataChunkIndex, dataBuffer)
        }
        else if (mt === 'streamDataError') {
            const metaData = header.body.metaData
            if (!isStreamDataErrorMetaData(metaData)) {
                // do we want to throw error here? ban node?
                throw Error('Invalid meta data for stream data error message')
            }
            const ds = this.#incomingDataStreams.get(metaData.streamId)
            if (!ds) {
                // do we want to throw error here?
                /* istanbul ignore next */
                throw Error('No incoming data stream found for data chunk error')
            }
            ds.producer().error(Error(metaData.errorMessage.toString()))
        }
        else if (mt === 'streamDataEnd') {
            const metaData = header.body.metaData
            if (!isStreamDataEndMetaData(metaData)) {
                // do we want to throw error here? ban node?
                /* istanbul ignore next */
                throw Error('Invalid meta data for stream data end message')
            }
            const ds = this.#incomingDataStreams.get(metaData.streamId)
            if (!ds) {
                // do we want to throw error here?
                /* istanbul ignore next */
                throw Error('No incoming data stream found for data end error')
            }
            ds.producer().unorderedEnd(metaData.numDataChunks)
        }
    }
    _createUdpMessageParts(udpMessageType: UdpMessageType, toAddress: Address | null, messageData: Buffer, metaData: UdpMessageMetaData, opts: {payloadIsJson: boolean}): UdpMessagePart[] {
        const parts: UdpMessagePart[] = []
        const partSize = UDP_PACKET_SIZE - UDP_MESSAGE_HEADER_SIZE
        const buffers: Buffer[] = []
        let i = 0
        while (i < messageData.length) {
            buffers.push(messageData.slice(i, i + partSize))
            i += partSize
        }
        if (buffers.length === 0) {
            // important to have at least one so that the header gets sent (some messages are header-only)
            buffers.push(Buffer.alloc(0))
        }
        const udpMessageId = createUdpMessageId()
        buffers.forEach((b: Buffer, ii: number) => {
            const body = {
                udpMessageId,
                protocolVersion: protocolVersion(),
                fromNodeId: this.#node.nodeId(),
                toAddress,
                udpMessageType: udpMessageType,
                metaData,
                partIndex: partIndex(ii),
                numParts: numParts(buffers.length),
                payloadIsJson: opts.payloadIsJson
            }
            const header: UdpHeader = {
                body,
                signature: getSignature(body, this.#node.keyPair())
            }
            parts.push({
                header,
                dataBuffer: b
            })
        })
        return parts
    }
}

class FallbackPacketSender {
    constructor(private node: KacheryP2PNode) {
    }
    async sendPacket(fallbackAddress: FallbackAddress, packetId: PacketId, packet: Buffer): Promise<void> {
        if (!isNodeIdFallbackAddress(fallbackAddress)) {
            /* istanbul ignore next */
            throw Error('Invalid fallback address')
        }
        const requestData: FallbackUdpPacketRequestData = {
            requestType: 'fallbackUdpPacket',
            dataBase64: packet.toString('base64'),
            packetId
        }
        await this.node.remoteNodeManager().sendRequestToNode(fallbackAddress.nodeId, requestData, {timeoutMsec: TIMEOUTS.fallbackUdpPacket, method: 'udp-fallback'})
    }
}