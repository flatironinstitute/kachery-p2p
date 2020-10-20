import dgram from 'dgram';
import { action } from "../common/action";
import { getSignature, verifySignature } from "../common/crypto_util";
import GarbageMap from "../common/GarbageMap";
import { DgramSocket } from '../external/ExternalInterface';
import { Address, durationMsec, DurationMsec, durationMsecToNumber, hostName, JSONObject, nodeIdToPublicKey, Port, portToNumber, RequestId, toPort, tryParseJsonObject } from "../interfaces/core";
import { isNodeToNodeRequest, isNodeToNodeResponse, NodeToNodeRequest, NodeToNodeResponse } from "../interfaces/NodeToNodeRequest";
import { createUdpMessageId, isUdpHeader, numParts, NumParts, partIndex, PartIndex, UdpHeader, UdpMessagePart, UdpMessageType, UDP_MESSAGE_HEADER_SIZE, UDP_PACKET_SIZE } from "../interfaces/UdpMessage";
import KacheryP2PNode from "../KacheryP2PNode";
import { protocolVersion } from "../protocolVersion";
import UdpMessagePartManager from '../udp/UdpMessagePartManager';
import UdpPacketReceiver from '../udp/UdpPacketReceiver';
import UdpPacketSender from "../udp/UdpPacketSender";

interface ResponseListener {
    onResponse: (response: NodeToNodeResponse, header: UdpHeader) => void
}

interface DataListener {
    onData: (partIndex: PartIndex, numParts: NumParts, data: Buffer) => void,
    onFinished: () => void
}

export default class PublicUdpSocketServer {
    #node: KacheryP2PNode
    #messagePartManager = new UdpMessagePartManager()
    #socket: DgramSocket | null = null
    #udpPacketSender: UdpPacketSender | null = null
    #udpPacketReceiver: UdpPacketReceiver | null = null
    #responseListeners = new GarbageMap<RequestId, ResponseListener>(durationMsec(3 * 60 * 1000))
    constructor(node: KacheryP2PNode) {
        this.#node = node
        this.#messagePartManager.onMessageComplete((remoteAddress, header, buffer) => {this._handleCompleteMessage(remoteAddress, header, buffer)})
    }
    stop() {
        if (this.#socket) {
            this.#socket.close()
        }
    }
    startListening(listenPort: Port) {
        return new Promise((resolve, reject) => {
            try {
                this.#socket = this.#node.dgramCreateSocket({ type: "udp4", reuseAddr: false })
                this.#socket.bind(portToNumber(listenPort))
                this.#socket.on("listening", () => {
                    if (this.#socket === null) {
                        throw Error('Unexpected')
                    }
                    this.#udpPacketSender = new UdpPacketSender(this.#socket)
                    this.#udpPacketReceiver = new UdpPacketReceiver(this.#socket)
                    this.#udpPacketReceiver.onPacket((packet: Buffer, remoteInfo: dgram.RemoteInfo) => {
                        const headerTxt = packet.slice(0, UDP_MESSAGE_HEADER_SIZE).toString().trimEnd()
                        const dataBuffer = packet.slice(UDP_MESSAGE_HEADER_SIZE);
                        const header = tryParseJsonObject(headerTxt)
                        if (header === null) {
                            return;
                        }
                        if (!isUdpHeader(header)) {
                            console.warn(header)
                            console.warn('Problem with udp header')
                            return;
                        }
                        const fromAddress: Address = {
                            port: toPort(remoteInfo.port),
                            hostName: hostName(remoteInfo.address)
                        }
                        /////////////////////////////////////////////////////////////////////////
                        action('handleUdpMessagePart', {fromAddress, fromNodeId: header.body.fromNodeId, udpMessageType: header.body.udpMessageType}, async () => {
                            this._handleMessagePart(fromAddress, header, dataBuffer);
                        }, async () => {
                        })
                        /////////////////////////////////////////////////////////////////////////
                    })
                    this.#udpPacketReceiver.onConfirmation((packetId) => {
                        /////////////////////////////////////////////////////////////////////////
                        action('confirmUdpPacket', {packetId}, async () => {
                            if (this.#udpPacketSender === null) {
                                throw Error('Unexpected')
                            }
                            this.#udpPacketSender.confirmPacket(packetId)
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
            setTimeout(() => {
                if (!complete) {
                    _handleError(Error(`Timeout waiting for response for request: ${request.body.requestData.requestType}`))
                }
            }, durationMsecToNumber(opts.timeoutMsec))
            /////////////////////////////////////////////////////////////////////////
            action('/Udp/sendNodeToNodeRequest', {}, async () => {
                await this._sendMessage(address, "NodeToNodeRequest", request as any as JSONObject, {timeoutMsec: opts.timeoutMsec, requestId: request.body.requestId})
            }, async () => {
            })
            /////////////////////////////////////////////////////////////////////////
        })
    }
    async _sendMessage(address: Address, messageType: UdpMessageType, messageData: Buffer | JSONObject, opts: {timeoutMsec: DurationMsec, requestId: RequestId | null}): Promise<void> {
        if ((this.#socket === null) || (this.#udpPacketSender === null)) {
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
        const parts: UdpMessagePart[] = this._createUdpMessageParts(messageType, address, messageBuffer, {payloadIsJson, requestId: opts.requestId})
        const packets: Buffer[] = []
        for (let part of parts) {
            const b = Buffer.concat([
                Buffer.from(JSON.stringify(part.header).padEnd(UDP_MESSAGE_HEADER_SIZE, ' ')),
                part.dataBuffer
            ])
            packets.push(b)
        }
        await this.#udpPacketSender.sendPackets(address, packets, {timeoutMsec: opts.timeoutMsec})
    }
    _handleMessagePart(fromAddress: Address, header: UdpHeader, dataBuffer: Buffer) {
        if (!verifySignature(header.body, header.signature, nodeIdToPublicKey(header.body.fromNodeId))) {
            throw Error('Error verifying signature in udp message')
        }
        this.#messagePartManager.addMessagePart(fromAddress, header.body.udpMessageId, header.body.partIndex, header.body.numParts, header, dataBuffer)
    }
    _handleCompleteMessage(remoteAddress: Address, header: UdpHeader, dataBuffer: Buffer) {
        const mt = header.body.udpMessageType
        if (mt === "NodeToNodeRequest") {
            const req = tryParseJsonObject(dataBuffer.toString())
            if (!isNodeToNodeRequest(req)) {
                // todo: what to do here? throw error? ban peer?
                return
            }
            /////////////////////////////////////////////////////////////////////////
            action('/Udp/handleNodeToNodeRequest', {fromNodeId: req.body.fromNodeId, requestId: req.body.requestId, requestType: req.body.requestData.requestType}, async () => {
                const response: NodeToNodeResponse = await this.#node.handleNodeToNodeRequest(req)
                await this._sendMessage(remoteAddress, "NodeToNodeResponse", response as any as JSONObject, {timeoutMsec: durationMsec(5000), requestId: req.body.requestId})
            }, async () => {
            })
            /////////////////////////////////////////////////////////////////////////
        }
        else if (mt === "NodeToNodeResponse") {
            const res = tryParseJsonObject(dataBuffer.toString())
            if (!isNodeToNodeResponse(res)) {
                // todo: what to do here? throw error? ban peer?
                return
            }
            /////////////////////////////////////////////////////////////////////////
            action('/Udp/handleNodeToNodeResponse', {fromNodeId: res.body.fromNodeId, requestId: res.body.requestId, requestType: res.body.responseData.requestType}, async () => {
                const responseListener = this.#responseListeners.get(res.body.requestId)
                if (responseListener) {
                    responseListener.onResponse(res, header)
                }
                else {
                    console.warn('No response listener found.')
                }
            }, async () => {                
            })
            /////////////////////////////////////////////////////////////////////////
        }
        else if (mt === "KeepAlive") {
            // todo
        }
    }
    _createUdpMessageParts(udpMessageType: UdpMessageType, toAddress: Address, messageData: Buffer, opts: {payloadIsJson: boolean, requestId: RequestId | null}): UdpMessagePart[] {
        const parts: UdpMessagePart[] = []
        const partSize = UDP_PACKET_SIZE - UDP_MESSAGE_HEADER_SIZE
        const buffers: Buffer[] = []
        let i = 0
        while (i < messageData.length) {
            buffers.push(messageData.slice(i, i + partSize))
            i += partSize
        }
        const udpMessageId = createUdpMessageId()
        buffers.forEach((b: Buffer, ii: number) => {
            const body = {
                udpMessageId,
                protocolVersion: protocolVersion(),
                fromNodeId: this.#node.nodeId(),
                toAddress,
                udpMessageType: udpMessageType,
                partIndex: partIndex(ii),
                numParts: numParts(buffers.length),
                payloadIsJson: opts.payloadIsJson,
                requestId: opts.requestId
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

