const isObject = (x: any) => {
    return ((x !== null) && (typeof x === 'object'));
}

const isString = (x: any) => {
    return ((x !== null) && (typeof x === 'string'));
}

const isFunction = (x: any) => {
    return ((x !== null) && (typeof x === 'function'));
}

const isNumber = (x: any) => {
    return ((x !== null) && (typeof x === 'number'));
}

const isNull = (x: any) => {
    return x === null;
}

const oneOf = (testFunctions: Function[]): ((x: any) => boolean) => {
    return (x) => {
        for (let tf of testFunctions) {
            if (!tf(x)) return false;
        }
        return true;
    }
}

const equalTo = (value: any): ((x: any) => boolean) => {
    return (x) => {
        return x === value;
    }
}

export interface Address {
    hostName: HostName,
    port: Port
}
export const isAddress = (x: any): x is Address => {
    return validateObject(x, {
        hostName: isHostName,
        port: isPort
    });
}

export interface Port extends Number {
    __port__: never
}
const isPort = (x: any) : x is Port => {
    if (!isNumber(x)) return false;
    return true;
}

export interface HostName extends String {
    __hostName__: never
}
const isHostName = (x: any): x is HostName => {
    if (!isString(x)) return false;
    return (/^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\\-]*[a-zA-Z0-9])\\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\\-]*[A-Za-z0-9])$/.test(x));
}

export interface Timestamp extends Number {
    __timestamp__: never
}
const isTimestamp = (x: any) : x is Timestamp => {
    if (!isNumber(x)) return false;
    return true;
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
const isSignature = (x: any): x is Signature => {
    if (!isString(x)) return false;
    return (/^[0-9a-f]{64}?$/.test(x));
}

export interface NodeId extends String {
    __nodeId__: never // phantom type
}
const isNodeId = (x: any): x is NodeId => {
    if (!isString(x)) return false;
    return (/^[0-9a-f]{64}?$/.test(x));
}
export interface ChannelName extends String {
    __channelName__: never // phantom type
}
const isChannelName = (x: any): x is ChannelName => {
    if (!isString(x)) return false;
    return (/^[0-9a-zA-Z_\-\.]{4,160}?$/.test(x));
}

export interface FeedId extends String {
    __feedId__: never // phantom type
}
const isFeedId = (x: any): x is FeedId => {
    if (!isString(x)) return false;
    return (/^[0-9a-f]{64}?$/.test(x));
}

export interface SubfeedHash extends String {
    __subfeedHash__: never
}
const isSubfeedHash = (x: any): x is SubfeedHash => {
    if (!isString(x)) return false;
    return (/^[0-9a-f]{40}?$/.test(x));
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
const isChannelNodeInfo = (x: any): x is ChannelNodeInfo => {
    return validateObject(x, {
        body: {
            channelName: isChannelName,
            nodeId: isNodeId,
            httpAddress: oneOf([isNull, isAddress]),
            webSocketAddress: oneOf([isNull, isAddress]),
            udpAddress: oneOf([isNull, isAddress]),
            timestamp: isTimestamp
        },
        signature: isSignature
    })
}

export interface AnnounceRequestData {
    type: "announceRequest",
    channelNodeInfo: ChannelNodeInfo
}
export const isAnnounceRequestData = (x: any): x is AnnounceRequestData => {
    return validateObject(x, {
        type: equalTo('announceRequest'),
        channelNodeInfo: isChannelNodeInfo
    })
}

export interface SignedSubfeedMessage {
    body: {
        previousSignature: Signature,
        messageNumber: number,
        message: Object
    },
    signature: Signature
}
export const isSignedSubfeedMessage = (x: any): x is SignedSubfeedMessage => {
    return validateObject(x, {
        body: {
            previousSignature: isSignature,
            messageNumber: isNumber,
            message: isObject
        },
        signature: isSignature
    });
}

const validateObject = (x: any, spec: any): boolean => {
    if (!x) return false;
    if (!isObject(x)) return false;
    for (let k in x) {
        if (!(k in spec)) return false;
    }
    for (let k in spec) {
        if (!(k in x)) return false;
        if (isObject(spec[k])) {
            if (!validateObject(x[k], spec[k])) return false;
        }
        else if (isFunction(spec[k])) {
            if (!spec[k](x[k])) return false;
        }
        else {
            console.warn(spec);
            throw Error('Invalid spec in validateObject');
        }
    }
    return true;
}
