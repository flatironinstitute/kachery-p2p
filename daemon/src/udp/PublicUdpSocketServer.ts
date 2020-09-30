import KacheryP2PNode from "../KacheryP2PNode"
import dgram from 'dgram'
import { Address, HostName, JSONObject, nodeIdToPublicKey, Port, toNumber, tryParseJsonObject, _validateObject } from "../interfaces/core";
import { getSignature, verifySignature } from "../common/crypto_util";
import { action } from "../action";
import { isUdpHeader, UDP_MESSAGE_HEADER_SIZE, UdpHeader, UdpMessagePart, UdpMessageType, UDP_PACKET_SIZE, createUdpMessageId, partIndex, numParts } from "../interfaces/UdpMessage";
import UdpMessagePartManager from './UdpMessagePartManager'
import { isNodeToNodeRequest, isNodeToNodeResponse, NodeToNodeRequest, NodeToNodeResponse } from "../interfaces/NodeToNodeRequest";
import { protocolVersion } from "../protocolVersion";
import UdpPacketSender from "./UdpPacketSender";

export default class PublicUdpSocketServer {
    #node: KacheryP2PNode
    #messagePartManager = new UdpMessagePartManager()
    #onRequestCallbacks: ((request: NodeToNodeRequest) => void)[] = []
    #onResponseCallbacks: ((response: NodeToNodeResponse) => void)[] = []
    #socket: dgram.Socket | null = null
    #udpPacketSender: UdpPacketSender | null = null
    constructor(node: KacheryP2PNode) {
        this.#node = node
        this.#messagePartManager.onMessageComplete(this._handleCompleteMessage)
    }
    startListening(listenPort: Port) {
        return new Promise((resolve, reject) => {
            try {
                this.#socket = dgram.createSocket({ type: "udp4" });
                this.#socket.bind(toNumber(listenPort));
                this.#socket.on("listening", () => {
                    if (this.#socket === null) {
                        throw Error('Unexpected')
                    }
                    this.#udpPacketSender = new UdpPacketSender(this.#socket)
                    this.#udpPacketSender.onPacket((packet: Buffer, remoteInfo: dgram.RemoteInfo) => {
                        const headerTxt = packet.slice(0, UDP_MESSAGE_HEADER_SIZE).toString().trimEnd()
                        const dataBuffer = packet.slice(UDP_MESSAGE_HEADER_SIZE);
                        const header = tryParseJsonObject(headerTxt)
                        if (header === null) {
                            return;
                        }
                        if (!isUdpHeader(header)) {
                            return;
                        }
                        const fromAddress: Address = {
                            port: remoteInfo.port as any as Port,
                            hostName: remoteInfo.address as any as HostName
                        }
                        action('handleUdpMessagePart', {fromAddress, fromNodeId: header.body.fromNodeId, udpMessageType: header.body.udpMessageType}, async () => {
                            this._handleMessagePart(fromAddress, header, dataBuffer);
                        }, async () => {
                        })
                    })
                    resolve();
                });
                this.#socket.on("message", (message, remoteInfo) => {
                    
                })
            }
            catch(err) {
                reject(err);
            }
        });
    }
    onRequest(callback: (request: NodeToNodeRequest) => void) {
        this.#onRequestCallbacks.push(callback)
    }
    onResponse(callback: (response: NodeToNodeResponse) => void) {
        this.#onResponseCallbacks.push(callback)
    }
    async sendRequest(address: Address, request: NodeToNodeRequest, opts: {timeoutMsec: number}): Promise<void> {
        return await this._sendMessage(address, "NodeToNodeRequest", request as any as JSONObject, {timeoutMsec: opts.timeoutMsec})
    }
    async sendResponse(address: Address, response: NodeToNodeResponse, opts: {timeoutMsec: number}): Promise<void> {
        return await this._sendMessage(address, "NodeToNodeResponse", response as any as JSONObject, {timeoutMsec: opts.timeoutMsec})
    }
    async _sendMessage(address: Address, messageType: UdpMessageType, messageData: Buffer | JSONObject, opts: {timeoutMsec: number}): Promise<void> {
        if ((this.#socket === null) || (this.#udpPacketSender === null)) {
            throw Error("Cannot _sendMessage before calling startListening()")
        }
        let payloadIsJson: boolean;
        let messageBuffer: Buffer
        if (Buffer.isBuffer(messageData)) {
            payloadIsJson = false
            messageBuffer = messageData
        }
        else {
            payloadIsJson = true;
            messageBuffer = Buffer.from(JSON.stringify(messageData))
        }
        const parts: UdpMessagePart[] = this._createUdpMessageParts("NodeToNodeRequest", messageBuffer, {payloadIsJson})
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
        const id = {
            udpMessageId: header.body.udpMessageId,
            partIndex: header.body.partIndex,
            numParts: header.body.numParts
        }
        this.#messagePartManager.addMessagePart(id, header, dataBuffer)
    }
    _handleCompleteMessage(header: UdpHeader, dataBuffer: Buffer) {
        const mt = header.body.udpMessageType
        if (mt === "NodeToNodeRequest") {
            const req = tryParseJsonObject(dataBuffer.toString())
            if (!isNodeToNodeRequest(req)) {
                // todo: what to do here? throw error? ban peer?
                return
            }
            this.#onRequestCallbacks.forEach(cb => cb(req))
        }
        else if (mt === "NodeToNodeResponse") {
            const res = tryParseJsonObject(dataBuffer.toString())
            if (!isNodeToNodeResponse(res)) {
                // todo: what to do here? throw error? ban peer?
                return
            }
            this.#onResponseCallbacks.forEach(cb => cb(res))
        }
        else if (mt === "KeepAlive") {
            // todo
        }
        else if (mt === "Data") {
            // todo
        }
    }
    _createUdpMessageParts(udpMessageType: UdpMessageType, messageData: Buffer, opts: {payloadIsJson: boolean}): UdpMessagePart[] {
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
                udpMessageType: udpMessageType,
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

