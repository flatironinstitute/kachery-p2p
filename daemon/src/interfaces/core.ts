import { hexToPublicKey } from "../common/crypto_util";
import { randomAlphaString } from "../common/util";

export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONObject | JSONArray;
export type JSONObject = { [member: string]: JSONValue };
export interface JSONArray extends Array<JSONValue> {}
export const isJSONObject = (x: any): x is JSONObject => {
    if (!isObject(x)) return false;
    return isJSONSerializable(x);
}
const isJSONSerializable = (obj: Object): boolean => {
    const isPlainObject = (a: Object) => {
        return Object.prototype.toString.call(a) === '[object Object]';
    };
    const isPlain = (a: any) => {
      return (a === null) || (typeof a === 'undefined' || typeof a === 'string' || typeof a === 'boolean' || typeof a === 'number' || Array.isArray(a) || isPlainObject(a));
    }
    if (!isPlain(obj)) {
      return false;
    }
    for (let property in obj) {
      if (obj.hasOwnProperty(property)) {
        if (!isPlain(obj[property])) {
          return false;
        }
        if (typeof obj[property] === "object") {
          if (!isJSONSerializable(obj[property])) {
            return false;
          }
        }
      }
    }
    return true;
}

// object
export const isObject = (x: any): x is Object => {
    return ((x !== null) && (typeof x === 'object'));
}

// string
export const isString = (x: any): x is string => {
    return ((x !== null) && (typeof x === 'string'));
}

// function
const isFunction = (x: any): x is Function => {
    return ((x !== null) && (typeof x === 'function'));
}

// number
export const isNumber = (x: any): x is number => {
    return ((x !== null) && (typeof x === 'number'));
}

// bigint
export const isBigInt = (x: any): x is bigint => {
    return ((x !== null) && (typeof x === 'bigint'));
}

// null
export const isNull = (x: any): x is null => {
    return x === null;
}

// boolean
export const isBoolean = (x: any): x is boolean => {
    return ((x !== null) && (typeof x === 'boolean'));
}

// isOneOf
export const isOneOf = (testFunctions: Function[]): ((x: any) => boolean) => {
    return (x) => {
        for (let tf of testFunctions) {
            if (tf(x)) return true;
        }
        return false;
    }
}

export const optional = (testFunction: Function): ((x: any) => boolean) => {
    return (x) => {
        return ((x === undefined) || (testFunction(x)));
    }
}

// isEqualTo
export const isEqualTo = (value: any): ((x: any) => boolean) => {
    return (x) => {
        return x === value;
    }
}

// isArrayOf
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

// isObjectOf
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

// Address
export interface Address {
    hostName: HostName,
    port: Port
}
export const isAddress = (x: any): x is Address => {
    return _validateObject(x, {
        hostName: isHostName,
        port: isPort
    });
}

// Port
export interface Port extends Number {
    __port__: never
}
export const isPort = (x: any) : x is Port => {
    if (!isNumber(x)) return false;
    return true;
}
export const toNumber = (x: Port): number => {
    return x as any as number;
}

// HostName
export interface HostName extends String {
    __hostName__: never
}
export const isHostName = (x: any): x is HostName => {
    if (!isString(x)) return false;
    return (/^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\\-]*[a-zA-Z0-9])\\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\\-]*[A-Za-z0-9])$/.test(x));
}

// TimeStamp
export interface Timestamp extends Number {
    __timestamp__: never
}
export const isTimestamp = (x: any) : x is Timestamp => {
    if (!isNumber(x)) return false;
    return true;
}
export const nowTimestamp = () => {
    const ret = new Date()
    return ret as any as Timestamp
}

// PublicKey
export interface PublicKey extends String {
    __publicKey__: never // phantom type so that we cannot assign directly to a string
}

// PrivateKey
export interface PrivateKey extends String {
    __privateKey__: never // phantom type
}

// PublicKeyHex
export interface PublicKeyHex extends String {
    __publicKeyHex__: never // phantom type so that we cannot assign directly to a string
}

// PrivateKeyHex
export interface PrivateKeyHex extends String {
    __privateKeyHex__: never // phantom type
}

// Sha1Hash
export interface Sha1Hash extends String {
    __sha1Hash__: never // phantom type
}

export const nodeIdToPublicKey = (nodeId: NodeId): PublicKey => {
    return hexToPublicKey(nodeId.toString() as any as PublicKeyHex);
}

// KeyPair
export interface KeyPair {
    publicKey: PublicKey,
    privateKey: PrivateKey
}

// Signature
export interface Signature extends String {
    __signature__: never
}
export const isSignature = (x: any): x is Signature => {
    if (!isString(x)) return false;
    return (/^[0-9a-f]{64}?$/.test(x));
}

// NodeId
export interface NodeId extends String {
    __nodeId__: never // phantom type
}
export const isNodeId = (x: any): x is NodeId => {
    if (!isString(x)) return false;
    return (/^[0-9a-f]{64}?$/.test(x));
}

// ChannelName
export interface ChannelName extends String {
    __channelName__: never // phantom type
}
export const isChannelName = (x: any): x is ChannelName => {
    if (!isString(x)) return false;
    return (/^[0-9a-zA-Z_\-\.]{4,160}?$/.test(x));
}

// FeedId
export interface FeedId extends String {
    __feedId__: never // phantom type
}
export const isFeedId = (x: any): x is FeedId => {
    if (!isString(x)) return false;
    return (/^[0-9a-f]{64}?$/.test(x));
}

// Conversion between types
export const feedIdToPublicKeyHex = (feedId: FeedId): PublicKeyHex => {
    return feedId as any as PublicKeyHex;
}
export const publicKeyHexToNodeId = (x: PublicKeyHex) : NodeId => {
    return x as any as NodeId;
}


// SubfeedHash
export interface SubfeedHash extends String {
    __subfeedHash__: never
}
export const isSubfeedHash = (x: any): x is SubfeedHash => {
    if (!isString(x)) return false;
    return (/^[0-9a-f]{40}?$/.test(x));
}

// FileKey
// todo: expand FileKey type
export interface FileKey {
    sha1: Sha1Hash,
    chunkOf?: {
        fileKey: FileKey,
        startByte: bigint,
        endByte: bigint
    }
}
export const isFileKey = (x: any): x is FileKey => {
    return _validateObject(x, {
        sha1: (a: any) => (isString(a) && /^[0-9a-f]{40}?$/.test(a))
    });
}

// FindLiveFeedResult
// todo
export interface FindLiveFeedResult {
    nodeId: NodeId
}

export interface ChannelNodeInfoBody {
    channelName: ChannelName,
    nodeId: NodeId,
    httpAddress: Address | null,
    webSocketAddress: Address | null,
    udpAddress: Address | null,
    proxyHttpAddresses: Address[],
    timestamp: Timestamp
}

// ChannelNodeInfo
export interface ChannelNodeInfo {
    body: ChannelNodeInfoBody,
    signature: Signature
}
export const isChannelNodeInfo = (x: any): x is ChannelNodeInfo => {
    return _validateObject(x, {
        body: {
            channelName: isChannelName,
            nodeId: isNodeId,
            httpAddress: isOneOf([isNull, isAddress]),
            webSocketAddress: isOneOf([isNull, isAddress]),
            udpAddress: isOneOf([isNull, isAddress]),
            timestamp: isTimestamp
        },
        signature: isSignature
    })
}

// SignedSubfeedMessage
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
    return _validateObject(x, {
        body: {
            previousSignature: isSignature,
            messageNumber: isNumber,
            message: isObject
        },
        signature: isSignature
    });
}

// SubfeedMessage
export interface SubfeedMessage extends JSONObject {
    __subfeedMessage__: never;
};
export const isSubfeedMessage = (x: any): x is SubfeedMessage => {
    return isObject(x);
}

// SubmittedSubfeedMessage
export interface SubmittedSubfeedMessage extends JSONObject {
    __submittedSubfeedMessage__: never;
};
export const isSubmittedSubfeedMessage = (x: any): x is SubmittedSubfeedMessage => {
    return ((isObject(x)) && (JSON.stringify(x).length < 10000));
}
export const submittedSubfeedMessageToSubfeedMessage = (x: SubmittedSubfeedMessage) => {
    return x as any as SubfeedMessage;
}

// SubfeedMessageMetaData
export type SubfeedMessageMetaData = Object;
export const isSubfeedMessageMetaData = (x: any): x is SubfeedMessageMetaData => {
    return isObject(x);
}

// FeedsConfigFeed
export interface FeedsConfigFeed {
    publicKey: PublicKeyHex,
    privateKey: PrivateKeyHex | undefined
}
export const isFeedsConfigFeed = (x: any): x is FeedsConfigFeed => {
    return _validateObject(x, {
        publicKey: isString,
        privateKey: isString
    });
}

// FeedName
export interface FeedName extends String {
    __feedName__: never; // phantom
}
export const isFeedName = (x: any): x is FeedName => {
    return isString(x);
}

// ErrorMessage
export interface ErrorMessage extends String {
    __errorMessage__: never; // phantom
}
export const isErrorMessage = (x: any): x is ErrorMessage => {
    return (isString(x)) && (x.length < 1000) ;
}
export const errorMessage = (x: string): ErrorMessage => {
    if (isErrorMessage(x)) return x;
    else {
        throw Error('Invalid error messsage');
    }
}

// objectToMap and mapToObject
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

// FeedsConfig and FeedsConfigRAM
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
    return _validateObject(x, {
        feeds: isObjectOf(isFeedId, isFeedsConfigFeed),
        feedIdsByName: isObjectOf(isFeedName, isFeedId)
    })
}

// SubfeedAccessRules
export interface SubfeedAccessRules {
    rules: SubfeedAccessRule[]
}
export const isSubfeedAccessRules = (x: any): x is SubfeedAccessRules => {
    return _validateObject(x, {
        rules: isArrayOf(isSubfeedAccessRule)
    })
}

// SubfeedAccessRule
export interface SubfeedAccessRule {
    nodeId: NodeId,
    write: boolean
}
export const isSubfeedAccessRule = (x: any): x is SubfeedAccessRule => {
    return _validateObject(x, {
        nodeId: isNodeId,
        write: isBoolean
    })
}


// SubfeedWatchName
export interface SubfeedWatchName extends String {
    __subfeedWatchName__: never; // phantom
}
export const isSubfeedWatchName = (x: any) => {
    return isString(x);
}

// SubfeedWatch
export interface SubfeedWatch {
    feedId: FeedId,
    subfeedHash: SubfeedHash,
    position: number
}
const isSubfeedWatch = (x: any): x is SubfeedWatch => {
    return _validateObject(x, {
        feedId: isFeedId,
        subfeedHash: isSubfeedHash,
        position: isNumber
    });
}

// FeedSubfeedId
export interface FeedSubfeedId extends String {
    __feedSubfeedId__: never; // phantom
}
export const feedSubfeedId = (feedId: FeedId, subfeedHash: SubfeedHash): FeedSubfeedId => {
    return (feedId.toString() + ':' + subfeedHash.toString()) as any as FeedSubfeedId; 
}

// SubfeedWatches and SubfeedWatchesRAM
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

// FindFileResult
export interface FindFileResult {
    nodeId: NodeId,
    fileKey: FileKey,
    fileSize: bigint
}

// RequestId
export interface RequestId extends String {
    __nodeId__: never // phantom type
}
export const isRequestId = (x: any): x is RequestId => {
    if (!isString(x)) return false;
    return (/^[A-Fa-f]{10}?$/.test(x));
}
export const createRequestId = () => {
    return randomAlphaString(10) as any as RequestId;
}

// LiveFeedSubscriptions
export interface LiveFeedSubscriptions {
    subscriptions: LiveFeedSubscription[]
}
export const isLiveFeedSubscriptions = (x: any): x is LiveFeedSubscriptions => {
    return _validateObject(x, {
        subscriptions: isArrayOf(isLiveFeedSubscription)
    })
}

// ChannelName
export interface LiveFeedSubscriptionName extends String {
    __liveFeedSubscriptionName__: never // phantom type
}
export const isLiveFeedSubscriptionName = (x: any): x is LiveFeedSubscriptionName => {
    if (!isString(x)) return false;
    return (/^[0-9a-zA-Z_\-\.]{4,160}?$/.test(x));
}

// LiveFeedSubscription
export interface LiveFeedSubscription {
    subscriptionName: LiveFeedSubscriptionName,
    feedId: FeedId,
    subfeedHash: SubfeedHash,
    position: number
}
export const isLiveFeedSubscription = (x: any): x is LiveFeedSubscription => {
    return _validateObject(x, {
        subscriptionName: isLiveFeedSubscriptionName,
        feedId: isFeedId,
        subfeedHash: isSubfeedHash,
        position: isNumber
    })
}

// ChannelInfo
export interface ChannelInfo {
    nodes: ChannelNodeInfo[]
}
export const isChannelInfo = (x: any): x is ChannelInfo => {
    return _validateObject(x, {
        nodes: isArrayOf(isChannelNodeInfo)
    })
}

type ValidateObjectSpec = {[key: string]: ValidateObjectSpec | (Function & ((a: any) => any))}

export const _validateObject = (x: any, spec: ValidateObjectSpec): boolean => {
    if (!x) return false;
    if (!isObject(x)) return false;
    for (let k in x) {
        if (!(k in spec)) return false;
    }
    for (let k in spec) {
        const specK = spec[k];
        if (isFunction(specK)) {
            if (!specK(x[k])) return false;
        }
        else {
            if (!(k in x)) return false;
            if (!_validateObject(x[k], specK as ValidateObjectSpec)) return false;
        }
    }
    return true;
}