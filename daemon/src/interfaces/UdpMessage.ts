import { JSONStringifyDeterministic } from '../common/crypto_util'
import { randomAlphaString } from '../common/util'
import { Address, isAddress, isBoolean, isJSONObject, isNodeId, isNumber, isProtocolVersion, isSignature, isString, NodeId, ProtocolVersion, Signature, _validateObject } from './core'

export const UDP_MESSAGE_HEADER_SIZE = 1000
export const UDP_PACKET_SIZE = 20000

// todo: do we use KeepAlive?
export type UdpMessageType = "NodeToNodeRequest" | "NodeToNodeResponse" | "KeepAlive" | "streamDataChunk" | "streamDataError" | "streamDataEnd"
const exampleUdpMessageType: UdpMessageType = "NodeToNodeRequest"
export const isUdpMessageType = (x: any): x is UdpMessageType => {
    if (!isString(x)) return false;
    const possible: UdpMessageType[] = [
        "NodeToNodeRequest",
        "NodeToNodeResponse",
        "KeepAlive",
        "streamDataChunk",
        "streamDataError",
        "streamDataEnd"
    ]
    return possible.includes(x as any as UdpMessageType)
}

export interface UdpMessageId extends String {
    __udpMessageId__: never // phantom type
}
const exampleUdpMessageId: UdpMessageId = "messageIdA" as any as UdpMessageId
export const isUdpMessageId = (x: any): x is UdpMessageId => {
    if (!isString(x)) return false;
    return (/^[A-Za-z]{10}$/.test(x));
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

export interface UdpMessagePartId extends String {
    __udpMessagePartId__: never
}
export const udpMessagePartId = (udpMessageId: UdpMessageId, partIndex: PartIndex, numParts: NumParts) => {
    return `${udpMessageId}:${partIndex}:${numParts}` as any as UdpMessagePartId
}

export interface UdpMessagePart {
    header: UdpHeader,
    dataBuffer: Buffer
}

export interface UdpMessageMetaData {
    __udpMessageMetaData__: never
}
export const isUdpMessageMetaData = (x: any): x is UdpMessageMetaData => {
    if (!isJSONObject(x)) return false
    if (JSONStringifyDeterministic(x).length > 100) {
        return false
    }
    return true
}
export const udpMessageMetaData = (x: any): UdpMessageMetaData => {
    if (JSONStringifyDeterministic(x).length > 100) {
        throw Error('UDP message meta data is too large')
    }
    return x as any as UdpMessageMetaData
}

export interface UdpHeader {
    body: {
        udpMessageId: UdpMessageId,
        protocolVersion: ProtocolVersion,
        fromNodeId: NodeId,
        toAddress: Address | null, // null happens if the incoming message came by fallback, and in this case we'll use fallback to send back
        udpMessageType: UdpMessageType,
        metaData: UdpMessageMetaData,
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
            toAddress: isAddress,
            udpMessageType: isUdpMessageType,
            metaData: isUdpMessageMetaData,
            partIndex: isPartIndex,
            numParts: isNumParts,
            payloadIsJson: isBoolean
        },
        signature: isSignature
    })
}