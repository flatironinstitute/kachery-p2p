import KacheryP2PNode from "./KacheryP2PNode"
import dgram from 'dgram'
import { isBoolean, isNodeId, isNumber, isProtocolVersion, isSignature, isString, JSONObject, NodeId, nodeIdToPublicKey, Port, ProtocolVersion, RequestId, Signature, toNumber, tryParseJsonObject, _validateObject } from "./interfaces/core";
import { randomAlphaString } from "./common/util";
import GarbageMap from "./common/GarbageMap";
import { verifySignature } from "./common/crypto_util";
import { action } from "./action";

const NODE_TO_NODE_REQUEST_MESSAGE_TYPE = 'NodeToNodeRequest'
const NODE_TO_NODE_RESPONSE_MESSAGE_TYPE = 'NodeToNodeResponse'
const KEEP_ALIVE_MESSAGE_TYPE = 'KeepAlive'
const MESSAGE_HEADER_SIZE = 1000

type UdpMessageType = "ConfirmUdpMessage" | "NodeToNodeRequest" | "NodeToNodeResponse" | "KeepAlive" | "Data"
const exampleUdpMessageType: UdpMessageType = "ConfirmUdpMessage"
const isUdpMessageType = (x: any): x is UdpMessageType => {
    if (!isString(x)) return false;
    return [
        "NodeToNodeRequest",
        "NodeToNodeResponse",
        "KeepAlive",
        "Data"
    ].includes(x)
}

interface UdpMessageId extends String {
    __udpMessageId__: never // phantom type
}
const exampleUdpMessageId: UdpMessageId = "messageIdA" as any as UdpMessageId
const isUdpMessageId = (x: any): x is UdpMessageId => {
    if (!isString(x)) return false;
    return (/^[A-Fa-f]{10}?$/.test(x));
}
const createUdpMessageId = () => {
    return randomAlphaString(10) as any as UdpMessageId;
}

export interface NumParts extends Number {
    __numParts__: never
}
const exampleNumParts = 1 as any as NumParts
export const isNumParts = (x: any) : x is NumParts => {
    if (!isNumber(x)) return false;
    if (x < 1) return false;
    return true;
}
export const numPartsToNumber = (x: NumParts): number => {
    return x as any as number;
}

interface PartIndex extends Number {
    __partIndex__: never
}
const examplePartIndex = 0 as any as PartIndex
const isPartIndex = (x: any) : x is PartIndex => {
    if (!isNumber(x)) return false;
    if (x < 0) return false;
    return true;
}
const partIndexToNumber = (x: PartIndex): number => {
    return x as any as number;
}
const partIndex = (i: number) => {
    return i as any as PartIndex
}

interface UdpMessagePartId {
    udpMessageId: UdpMessageId,
    partIndex: PartIndex,
    numParts: NumParts
}
const exampleUdpMessagePartId: UdpMessagePartId = {
    udpMessageId: exampleUdpMessageId,
    partIndex: examplePartIndex,
    numParts: exampleNumParts
}
const isUdpMessagePartId = (x: any): x is UdpMessagePartId => {
    return _validateObject(x, {
        udpMessageId: isUdpMessageId,
        partIndex: isPartIndex,
        numParts: isNumParts
    })
}

interface UdpHeader {
    body: {
        udpMessageId: UdpMessageId,
        protocolVersion: ProtocolVersion,
        fromNodeId: NodeId,
        messageType: UdpMessageType,
        partIndex: PartIndex,
        numParts: NumParts,
        payloadIsJson: boolean // todo: implement this
    },
    signature: Signature
}
const isUdpHeader = (x: any): x is UdpHeader => {
    return _validateObject(x, {
        body: {
            udpMessageId: isUdpMessageId,
            protocolVersion: isProtocolVersion,
            fromNodeId: isNodeId,
            messageType: isUdpMessageType,
            partIndex: isPartIndex,
            numParts: isNumParts,
            payloadIsJson: isBoolean
        },
        signature: isSignature
    })
}

interface ConfirmUdpMessagePayload {
    udpMessagePartId: UdpMessagePartId
}
const isConfirmUdpMessagePayload = (x: any): x is ConfirmUdpMessagePayload => {
    return _validateObject(x, {
        messagePartId: isUdpMessagePartId
    })
}

export default class PublicUdpSocketServer {
    #node: KacheryP2PNode
    #inProgressMessages = new GarbageMap<UdpMessageId, Buffer>(120 * 1000)
    #confirmedUdpMessages = new GarbageMap<UdpMessagePartId, boolean>(120 * 1000)
    #messagePartManager = new MessagePartManager()
    constructor(node: KacheryP2PNode) {
        this.#node = node
        this.#messagePartManager.onMessageComplete(this._handleCompleteMessage)
    }
    startListening(listenPort: Port) {
        return new Promise((resolve, reject) => {
            try {
                const socket = dgram.createSocket({ type: "udp4" });
                socket.bind(toNumber(listenPort));
                socket.on("listening", () => {
                    resolve();
                });
                socket.on("message", message => {
                    const headerTxt = message.slice(0, MESSAGE_HEADER_SIZE).toString()
                    const dataBuffer = message.slice(MESSAGE_HEADER_SIZE);
                    const header = tryParseJsonObject(headerTxt)
                    if (header === null) {
                        return;
                    }
                    if (!isUdpHeader(header)) {
                        return;
                    }
                    action('handleUdpMessagePart', {fromNodeId: header.body.fromNodeId, messageType: header.body.messageType}, async () => {
                        this._handleMessagePart(header, dataBuffer);
                    }, async () => {
                    })
                })
            }
            catch(err) {
                reject(err);
            }
        });
    }
    _handleMessagePart(header: UdpHeader, dataBuffer: Buffer) {
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
        // todo
    }
}

interface MessagePartData {
    header: UdpHeader,
    buffer: Buffer
}

class MessagePartManager {
    #messageParts = new GarbageMap<UdpMessagePartId, MessagePartData>(3 * 60 * 1000)
    #onMessageCompleteCallbacks: ((header: UdpHeader, data: Buffer) => void)[] = []
    constructor() {}
    addMessagePart(udpMessagePartId: UdpMessagePartId, header: UdpHeader, buffer: Buffer) {
        this.#messageParts.set(udpMessagePartId, {header, buffer})
        let complete = true
        const numParts = numPartsToNumber(udpMessagePartId.numParts)
        const buffers: Buffer[] = []
        const headers: UdpHeader[] = [] 
        for (let i = 0; i < numParts; i++) {
            const id = {
                udpMessageId: udpMessagePartId.udpMessageId,
                partIndex: partIndex(i),
                numParts: udpMessagePartId.numParts
            }
            const d = this.#messageParts.get(id)
            if (d) {
                buffers.push(d.buffer)
                headers.push(d.header)
            }
            else {
                complete = false;
                break;
            }
        }
        if (complete) {
            for (let i = 0; i < numParts; i++) {
                const id = {
                    udpMessageId: udpMessagePartId.udpMessageId,
                    partIndex: partIndex(i),
                    numParts: udpMessagePartId.numParts
                }
                this.#messageParts.delete(id)
            }
            const fullBuffer = Buffer.concat(buffers)
            this.#onMessageCompleteCallbacks.forEach(cb => {
                cb(headers[0], fullBuffer)
            })
        }
    }
    onMessageComplete(callback: (header: UdpHeader, data: Buffer) => void) {
        this.#onMessageCompleteCallbacks.push(callback)
    }
}