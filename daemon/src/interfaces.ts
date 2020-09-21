import { assert } from "console";

const isObject = (x: any): x is Object => {
    return ((x !== null) && (typeof x === 'object'));
}

export const isString = (x: any): x is string => {
    return ((x !== null) && (typeof x === 'string'));
}

const isFunction = (x: any): x is Function => {
    return ((x !== null) && (typeof x === 'function'));
}

export const isNumber = (x: any): x is number => {
    return ((x !== null) && (typeof x === 'number'));
}

export const isNull = (x: any): x is null => {
    return x === null;
}

const isBoolean = (x: any): x is boolean => {
    return ((x !== null) && (typeof x === 'boolean'));
}

const oneOf = (testFunctions: Function[]): ((x: any) => boolean) => {
    return (x) => {
        for (let tf of testFunctions) {
            if (tf(x)) return true;
        }
        return false;
    }
}

const equalTo = (value: any): ((x: any) => boolean) => {
    return (x) => {
        return x === value;
    }
}

export const isArrayOf = (testFunction: (x: any) => boolean): ((x: any) => boolean) => {
    return (x) => {
        if ((x !== null) && (Array.isArray(x))) {
            for (let a of x) {
                if (!testFunction(a)) return false;
            }
            return true;
        }
        else return false;
    }
}

const isObjectOf = (keyTestFunction: (x: any) => boolean, valueTestFunction: (x: any) => boolean): ((x: any) => boolean) => {
    return (x) => {
        if (isObject(x)) {
            for (let k in x) {
                if (!keyTestFunction(k)) return false;
                if (!valueTestFunction(x[k])) return false;
            }
            return true;
        }
        else return false;
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
export const nowTimestamp = () => {
    const ret = new Date()
    return ret as any as Timestamp
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
export const isNodeId = (x: any): x is NodeId => {
    if (!isString(x)) return false;
    return (/^[0-9a-f]{64}?$/.test(x));
}
export interface ChannelName extends String {
    __channelName__: never // phantom type
}
export const isChannelName = (x: any): x is ChannelName => {
    if (!isString(x)) return false;
    return (/^[0-9a-zA-Z_\-\.]{4,160}?$/.test(x));
}

export interface FeedId extends String {
    __feedId__: never // phantom type
}
export const isFeedId = (x: any): x is FeedId => {
    if (!isString(x)) return false;
    return (/^[0-9a-f]{64}?$/.test(x));
}

export interface SubfeedHash extends String {
    __subfeedHash__: never
}
export const isSubfeedHash = (x: any): x is SubfeedHash => {
    if (!isString(x)) return false;
    return (/^[0-9a-f]{40}?$/.test(x));
}

// todo: expand filekey type
export interface FileKey {
    sha1: Sha1Hash
}
export const isFileKey = (x: any): x is FileKey => {
    return validateObject(x, {
        sha1: (a: any) => (isString(a) && /^[0-9a-f]{40}?$/.test(a))
    });
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
        message: SubfeedMessage,
        timestamp: Timestamp,
        metaData?: SubfeedMessageMetaData
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

export interface SubfeedMessage extends Object {
    __subfeedMessage__: never;
};
export const isSubfeedMessage = (x: any): x is SubfeedMessage => {
    return isObject(x);
}

export type SubfeedMessageMetaData = Object;
export const isSubfeedMessageMetaData = (x: any): x is SubfeedMessageMetaData => {
    return isObject(x);
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

export interface FeedsConfigFeed {
    publicKey: PublicKeyHex,
    privateKey: PrivateKeyHex | undefined
}
export const isFeedsConfigFeed = (x: any): x is FeedsConfigFeed => {
    return validateObject(x, {
        publicKey: isString,
        privateKey: isString
    });
}

export interface FeedName extends String {
    __feedName__: never; // phantom
}
export const isFeedName = (x: any): x is FeedName => {
    return isString(x);
}

export const objectToMap = <KeyType extends String, ValueType>(obj: Object) => {
    return new Map<KeyType, ValueType>(Object.keys(obj).map(k => {
        return [k as any as KeyType, obj[k] as any as ValueType];
    }));
}

export const mapToObject = <KeyType extends String, ValueType>(m: Map<KeyType, ValueType>) => {
    const ret = {};
    m.forEach((v, k) => {
        ret[k.toString()] = v;
    });
    return ret;
}

export interface FeedsConfig {
    feeds: {[key: string]: FeedsConfigFeed},
    feedIdsByName: {[key: string]: FeedId}
}
export interface FeedsConfigRAM {
    feeds: Map<FeedId, FeedsConfigFeed>,
    feedIdsByName: Map<FeedName, FeedId>
}
export const toFeedsConfigRAM = (x: FeedsConfig): FeedsConfigRAM => {
    return {
        feeds: objectToMap<FeedId, FeedsConfigFeed>(x.feeds),
        feedIdsByName: objectToMap<FeedName, FeedId>(x.feedIdsByName)
    }
}
export const toFeedsConfig = (x: FeedsConfigRAM): FeedsConfig => {
    return {
        feeds: mapToObject<FeedId, FeedsConfigFeed>(x.feeds),
        feedIdsByName: mapToObject<FeedName, FeedId>(x.feedIdsByName)
    }
}
export const isFeedsConfig = (x: any): x is FeedsConfig => {
    return validateObject(x, {
        feeds: isObjectOf(isFeedId, isFeedsConfigFeed),
        feedIdsByName: isObjectOf(isFeedName, isFeedId)
    })
}

export interface SubfeedAccessRules {
    rules: SubfeedAccessRule[]
}
export const isSubfeedAccessRules = (x: any): x is SubfeedAccessRules => {
    return validateObject(x, {
        rules: isArrayOf(isSubfeedAccessRule)
    })
}

export interface SubfeedAccessRule {
    nodeId: NodeId,
    write: boolean
}
export const isSubfeedAccessRule = (x: any): x is SubfeedAccessRule => {
    return validateObject(x, {
        nodeId: isNodeId,
        write: isBoolean
    })
}


export interface SubfeedWatchName extends String {
    __subfeedWatchName__: never; // phantom
}
export const isSubfeedWatchName = (x: any) => {
    return isString(x);
}

export interface SubfeedWatch {
    feedId: FeedId,
    subfeedHash: SubfeedHash,
    position: number
}
const isSubfeedWatch = (x: any): x is SubfeedWatch => {
    return validateObject(x, {
        feedId: isFeedId,
        subfeedHash: isSubfeedHash,
        position: isNumber
    });
}

export interface FeedSubfeedId extends String {
    __feedSubfeedId__: never; // phantom
}
export const feedSubfeedId = (feedId: FeedId, subfeedHash: SubfeedHash): FeedSubfeedId => {
    return (toStr(feedId) + ':' + toStr(subfeedHash)) as any as FeedSubfeedId; 
}

export type SubfeedWatches = {[key: string]: SubfeedWatch};
export const isSubfeedWatches = (x: any): x is SubfeedWatches => {
    return isObjectOf(isSubfeedWatchName, isSubfeedWatch)(x);
}
export type SubfeedWatchesRAM = Map<SubfeedWatchName, SubfeedWatch>;
export const toSubfeedWatchesRAM = (x: SubfeedWatches) => {
    return objectToMap<SubfeedWatchName, SubfeedWatch>(x);
}
export const toSubfeedWatches = (x: SubfeedWatchesRAM) => {
    return mapToObject<SubfeedWatchName, SubfeedWatch>(x);
}

export interface FindFileResult {
    channelName: ChannelName,
    nodeId: NodeId,
    fileKey: FileKey,
    fileSize: bigint
}