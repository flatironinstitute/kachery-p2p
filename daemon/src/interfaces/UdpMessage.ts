import { randomAlphaString } from '../common/util'
import { isBoolean, isNodeId, isNumber, isProtocolVersion, isSignature, isString, NodeId, ProtocolVersion, Signature, _validateObject } from './core'

export const UDP_MESSAGE_HEADER_SIZE = 1000
export const UDP_PACKET_SIZE = 20000

export type UdpMessageType = "NodeToNodeRequest" | "NodeToNodeResponse" | "KeepAlive" | "Data"
const exampleUdpMessageType: UdpMessageType = "NodeToNodeRequest"
export const isUdpMessageType = (x: any): x is UdpMessageType => {
    if (!isString(x)) return false;
    const possible: UdpMessageType[] = [
        "NodeToNodeRequest",
        "NodeToNodeResponse",
        "KeepAlive",
        "Data"
    ]
    return possible.includes(x as any as UdpMessageType)
}

export interface UdpMessageId extends String {
    __udpMessageId__: never // phantom type
}
const exampleUdpMessageId: UdpMessageId = "messageIdA" as any as UdpMessageId
export const isUdpMessageId = (x: any): x is UdpMessageId => {
    if (!isString(x)) return false;
    return (/^[A-Fa-f]{10}?$/.test(x));
}
export const createUdpMessageId = () => {
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
export const numParts = (i: number) => {
    return i as any as NumParts
}

export interface PartIndex extends Number {
    __partIndex__: never
}
export const examplePartIndex = 0 as any as PartIndex
export const isPartIndex = (x: any) : x is PartIndex => {
    if (!isNumber(x)) return false;
    if (x < 0) return false;
    return true;
}
export const partIndexToNumber = (x: PartIndex): number => {
    return x as any as number;
}
export const partIndex = (i: number) => {
    return i as any as PartIndex
}

export interface MessagePartData {
    header: UdpHeader,
    buffer: Buffer
}

export interface UdpMessagePartId {
    udpMessageId: UdpMessageId,
    partIndex: PartIndex,
    numParts: NumParts
}
const exampleUdpMessagePartId: UdpMessagePartId = {
    udpMessageId: exampleUdpMessageId,
    partIndex: examplePartIndex,
    numParts: exampleNumParts
}
export const isUdpMessagePartId = (x: any): x is UdpMessagePartId => {
    return _validateObject(x, {
        udpMessageId: isUdpMessageId,
        partIndex: isPartIndex,
        numParts: isNumParts
    })
}

export interface UdpMessagePart {
    header: UdpHeader,
    dataBuffer: Buffer
}

export interface UdpHeader {
    body: {
        udpMessageId: UdpMessageId,
        protocolVersion: ProtocolVersion,
        fromNodeId: NodeId,
        udpMessageType: UdpMessageType,
        partIndex: PartIndex,
        numParts: NumParts,
        payloadIsJson: boolean
    },
    signature: Signature
}
export const isUdpHeader = (x: any): x is UdpHeader => {
    return _validateObject(x, {
        body: {
            udpMessageId: isUdpMessageId,
            protocolVersion: isProtocolVersion,
            fromNodeId: isNodeId,
            udpMessageType: isUdpMessageType,
            partIndex: isPartIndex,
            numParts: isNumParts,
            payloadIsJson: isBoolean
        },
        signature: isSignature
    })
}