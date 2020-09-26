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
const isUdpMessageId = (x: any): x is UdpMessageId => {
    if (!isString(x)) return false;
    return (/^[A-Fa-f]{10}?$/.test(x));
}
const createUdpMessageId = () => {
    return randomAlphaString(10) as any as UdpMessageId;
}

interface UdpMessagePartId {
    udpMessageId: UdpMessageId,
    partIndex: PartIndex
}
const isUdpMessagePartId = (x: any): x is UdpMessagePartId => {
    return _validateObject(x, {
        udpMessageId: isUdpMessageId,
        partIndex: isPartIndex
    })
}


export interface NumParts extends Number {
    __numParts__: never
}
export const isNumParts = (x: any) : x is NumParts => {
    if (!isNumber(x)) return false;
    if (x < 1) return false;
    return true;
}
export const numPartsToNumber = (x: NumParts): number => {
    return x as any as number;
}

export interface PartIndex extends Number {
    __partIndex__: never
}
export const isPartIndex = (x: any) : x is PartIndex => {
    if (!isNumber(x)) return false;
    if (x < 0) return false;
    return true;
}
export const partIndexToNumber = (x: PartIndex): number => {
    return x as any as number;
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
    constructor(node: KacheryP2PNode) {
        this.#node = node
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
                    action('handleUdpMessage', {fromNodeId: header.body.fromNodeId, messageType: header.body.messageType}, async () => {
                        this._handleMessage(header, dataBuffer);
                    }, async () => {
                    })
                })
            }
            catch(err) {
                reject(err);
            }
        });
    }
    _handleMessage(header: UdpHeader, dataBuffer: Buffer) {
        if (!verifySignature(header.body, header.signature, nodeIdToPublicKey(header.body.fromNodeId))) {
            throw Error('Error verifying signature in udp message')
        }
        const messageType = header.body.messageType
        if (messageType === "ConfirmUdpMessage") {
            const msg = tryParseJsonObject(dataBuffer.toString())
            if (!isConfirmUdpMessagePayload(msg)) {
                throw Error('Error in ConfirmUdpMessage')
            }
            this.#confirmedUdpMessages.set(msg.udpMessagePartId, true)
        }
        else if (messageType === "NodeToNodeRequest") {
            // todo
        }
        else if (messageType === "NodeToNodeResponse") {
            // todo
        }
        // todo: others
    }
}