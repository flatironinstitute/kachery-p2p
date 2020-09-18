import { validate } from "jsonschema";
import assert from 'assert'

export interface Address {
    hostName: HostName,
    port: Port
}
const vAddress = (x): Address => {
    return {
        hostName: vHostName(x.hostName),
        port: vPort(x.port)
    }
}

export interface Port extends Number {
    __port__: never
}
const vPort = (x) : Port => {
    assert(typeof(x) === 'number');
    return x as any as Port;
}

export interface HostName extends String {
    __hostName__: never
}
const vHostName = (x): HostName => {
    assert(typeof(x) === 'string');
    assert(/^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\\-]*[a-zA-Z0-9])\\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\\-]*[A-Za-z0-9])$/.test(x))
    return x as any as HostName;
}

export interface Timestamp extends Number {
    __timestamp__: never
}
const vTimestamp = (x) : Timestamp => {
    assert(typeof(x) === 'number');
    return x as any as Timestamp;
}

export interface PublicKey extends String {
    __publicKey__: never // phantom type so that we cannot assign directly to a string
}
export interface PrivateKey extends String {
    __privateKey__: never // phantom type
}
export interface PublicKeyHex extends String {
    __publicKeyHex__: never // phantom type so that we cannot assign directly to a string
}
export interface PrivateKeyHex extends String {
    __privateKeyHex__: never // phantom type
}
export interface Sha1Hash extends String {
    __sha1Hash__: never // phantom type
}
export interface KeyPair {
    publicKey: PublicKey,
    privateKey: PrivateKey
}
export interface Signature extends String {
    __signature__: never
}
const vSignature = (x): Signature => {
    assert(typeof x === 'string');
    assert(/^[0-9a-f]{64}?$/.test(x));
    return x as any as Signature
}

export interface NodeId extends String {
    __nodeId__: never // phantom type
}
const vNodeId = (x): NodeId => {
    assert(typeof x === 'string');
    assert(/^[0-9a-f]{64}?$/.test(x));
    return x as any as NodeId
}
export interface ChannelName extends String {
    __channelName__: never // phantom type
}
const vChannelName = (x): ChannelName => {
    assert(typeof x === 'string');
    assert(/^[0-9a-zA-Z_\-\.]{4,160}?$/.test(x));
    return x as any as ChannelName;
}

export interface FeedId extends String {
    __feedId__: never // phantom type
}
const vFeedId = (x): FeedId => {
    assert(typeof x === 'string');
    assert(/^[0-9a-f]{64}?$/.test(x));
    return x as any as FeedId
}

export interface SubfeedHash extends String {
    __subfeedHash__: never
}
const vSubfeedHash = (x): SubfeedHash => {
    assert(typeof x === 'string');
    assert(/^[0-9a-f]{40}?$/.test(x));
    return x as any as SubfeedHash
}

export interface FileKey extends Object {
    __fileKey__: never
}

export const feedIdToPublicKeyHex = (feedId: FeedId): PublicKeyHex => {
    return feedId as any as PublicKeyHex;
}

export const publicKeyHexToNodeId = (x: PublicKeyHex) : NodeId => {
    return x as any as NodeId;
}

export interface SignedMessage {
    signature: Signature
}

export const toStr = (x: PublicKey | PrivateKey | PublicKeyHex | PrivateKeyHex | Sha1Hash | Signature | NodeId | ChannelName | FeedId | SubfeedHash): string => {
    return x as any as string;
}

export interface FindLiveFeedResult {

}

export interface ChannelNodeInfo {
    body: {
        channelName: ChannelName,
        nodeId: NodeId,
        httpAddress: Address | null,
        webSocketAddress: Address | null,
        udpAddress: Address | null,
        timestamp: Timestamp
    },
    signature: Signature
}
const vChannelNodeInfo = (x): ChannelNodeInfo => {
    const body = x.body;
    return {
        body: {
            channelName: vChannelName(body.channelName),
            nodeId: vNodeId(body.nodeId),
            httpAddress: body.httpAddress ? vAddress(body.httpAddress) : null,
            webSocketAddress: body.webSocketAddress ? vAddress(body.webSocketAddress) : null,
            udpAddress: body.udpAddress ? vAddress(body.udpAddress) : null,
            timestamp: vTimestamp(body.timestamp)
        },
        signature: vSignature(x.signature)
    }
}

export interface AnnounceRequestData {
    type: "announceRequest",
    channelNodeInfo: ChannelNodeInfo
}
const vAnnounceRequestData = (x) => {
    assert(x.type === 'announceRequest');
    return {
        type: "announceRequest",
        channelNodeInfo: vChannelNodeInfo(x.channelNodeInfo)
    }
}

