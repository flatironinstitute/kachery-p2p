import assert from 'assert';
import { hexToPublicKey, JSONStringifyDeterministic } from "../common/crypto_util";
import { randomAlphaString } from "../common/util";
import { ByteCount, isByteCount } from '../udp/UdpCongestionManager';
import { AnnounceRequestData, isAnnounceRequestData } from "./NodeToNodeRequest";

export const _tests: {[key: string]: Function} = {}

export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONObject | JSONArray;
export type JSONObject = { [member: string]: JSONValue };
export interface JSONArray extends Array<JSONValue> {}
export const isJSONObject = (x: any): x is JSONObject => {
    if (!isObject(x)) return false;
    return isJSONSerializable(x);
}
export const tryParseJsonObject = (x: string): JSONObject | null => {
    let a: any;
    try {
        a = JSON.parse(x);
    }
    catch {
        return null;
    }
    if (!isJSONObject(a)) return null; // TODO: I think this may just be unreachable--parse should throw on failure
    return a;
}
export const isJSONSerializable = (obj: any): boolean => {
    if (!isObject(obj)) return false
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
export const isFunction = (x: any): x is Function => {
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

export const optional = (testFunctionOrSpec: Function | ValidateObjectSpec): ((x: any) => boolean) => {
    if (isFunction(testFunctionOrSpec)) {
        const testFunction: Function = testFunctionOrSpec
        return (x) => {
            return ((x === undefined) || (testFunction(x)));
        }
    }
    else {
        return (x) => {
            const obj: ValidateObjectSpec = testFunctionOrSpec
            return ((x === undefined) || (_validateObject(x, obj)))
        }
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
export const isObjectOf = (keyTestFunction: (x: any) => boolean, valueTestFunction: (x: any) => boolean): ((x: any) => boolean) => {
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

export type ValidateObjectSpec = {[key: string]: ValidateObjectSpec | (Function & ((a: any) => any))}

export const _validateObject = (x: any, spec: ValidateObjectSpec, opts: {verbose: boolean} = {verbose: false}): boolean => {
    if (!x) {
        if (opts.verbose) {
            console.warn(`Not an object *.`)
        }
        return false;
    }
    if (!isObject(x)) {
        if (opts.verbose) {
            console.warn('Not an object.')
        }
        return false;
    }
    for (let k in x) {
        if (!(k in spec)) {
            if (opts.verbose) {
                console.warn(`Key not in spec: ${k}`)
            }
            return false;
        }
    }
    for (let k in spec) {
        const specK = spec[k];
        if (isFunction(specK)) {
            if (!specK(x[k])) {
                if (opts.verbose) {
                    console.warn(`Problem validating: ${k}`)
                }
                return false;
            }
        }
        else {
            if (!(k in x)) {
                if (opts.verbose) {
                    console.warn(`Key not in x: ${k}`)
                }
                return false;
            }
            if (!_validateObject(x[k], specK as ValidateObjectSpec, opts)) {
                if (opts.verbose) {
                    console.warn(`Problem with: ${k}`)
                }
                return false;
            }
        }
    }
    return true;
}

// Versioning
export interface ProtocolVersion extends String {
    __protocolVersion__: never // phantom type
}
export const isProtocolVersion = (x: any): x is ProtocolVersion => {
    if (!isString(x)) return false;
    return (/^[0-9a-zA-z.\ \-]{4,30}$/.test(x));
}

export interface DaemonVersion extends String {
    __daemonVersion__: never // phantom
}
export const exampleDaemonVersion: DaemonVersion = "example-daemon.Version" as any as DaemonVersion
export const isDaemonVersion = (x: any): x is DaemonVersion => {
    if (!isString(x)) return false;
    return (/^[0-9a-zA-z\.\ \-]{4,40}?$/.test(x));
}


// Port
export interface Port extends Number {
    __port__: never
}
export const isPort = (x: any) : x is Port => {
    if (!isNumber(x)) return false;
    return x > 0 && x < 65536; // port numbers must be in 16-bit positive range
}
export const toNumber = (x: Port): number => {
    return x as any as number;
}

// HostName
export interface HostName extends String {
    __hostName__: never
}
export const isHostName = (x: any): x is HostName => {
    // TODO: can we be even more precise here? e.g. restrict number of elements?
    if (!isString(x)) return false;
    let result = true;
    x.split(".").forEach((element) => {
        if (element.length === 0) result = false;
        if (!/^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?$/.test(element)) result = false;
    });
    // we cannot short-circuit by returning false from the anonymous function in the forEach loop.
    // Doing so returns false *from that function*, then ignores the result (since nothing is checking
    // the result of the anonymous function) and moves on to check the next chunk.
    return result;
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

// TimeStamp
export interface Timestamp extends Number {
    __timestamp__: never
}
export const exampleTimestamp: Timestamp = Number(new Date(2020, 1, 1, 1, 1, 1, 0)) - 0 as any as Timestamp
export const isTimestamp = (x: any) : x is Timestamp => {
    if (!isNumber(x)) return false;
    if (x < 0) return false;  // For our purposes, timestamps should never be negative
    if (!Number.isInteger(x)) return false; // our timestamps should be whole numbers
    return true;
}
export const nowTimestamp = () => {
    const ret = Number(new Date()) - 0
    return ret as any as Timestamp
}
export const zeroTimestamp = () => {
    return 0 as any as Timestamp;
}
export const elapsedSince = (timestamp: Timestamp) => {
    return (nowTimestamp() as any as number) - (timestamp as any as number);
}

// PublicKey
export interface PublicKey extends String {
    __publicKey__: never // phantom type so that we cannot assign directly to a string
}
export const isPublicKey = (x: any) : x is PublicKey => {
    if (!isString(x)) return false;
    return checkKeyblockHeader(x, 'PUBLIC');
}

// PrivateKey
export interface PrivateKey extends String {
    __privateKey__: never // phantom type
}
export const isPrivateKey = (x: any) : x is PublicKey => {
    if (!isString(x)) return false;
    return checkKeyblockHeader(x, 'PRIVATE');
}

const checkKeyblockHeader = (key: string, type: 'PUBLIC' | 'PRIVATE') => {
    // note we need to double-escape the backslashes here.
    console.log(`Checking >${key}< against pattern.`)
    const pattern = new RegExp(`-----BEGIN ${type} KEY-----[\\s\\S]*-----END ${type} KEY-----\n*$`);
    return (pattern.test(key));
}

// KeyPair
export interface KeyPair {
    publicKey: PublicKey,
    privateKey: PrivateKey
}
export const isKeyPair = (x: any) : x is KeyPair => {
    return _validateObject(x, {
        publicKey: isPublicKey,
        privateKey: isPrivateKey
    });
}

export const isHexadecimal = (x: string, length?: number) : boolean => {
    const basePattern: string = '[0-9a-fA-F]';
    let pattern: string = `^${basePattern}*$`;
    if (length !== undefined) {
        assert(Number.isInteger(length));
        assert(length > 0);
        pattern = `^${basePattern}{${length}}$`;
    }
    const regex = new RegExp(pattern);

    return (regex.test(x));
}

// PublicKeyHex
export interface PublicKeyHex extends String {
    __publicKeyHex__: never // phantom type so that we cannot assign directly to a string
}
export const isPublicKeyHex = (x: any) : x is PublicKeyHex => {
    if (!isString(x)) return false;
    return isHexadecimal(x);
}

// PrivateKeyHex
export interface PrivateKeyHex extends String {
    __privateKeyHex__: never // phantom type
}
export const isPrivateKeyHex = (x: any) : x is PrivateKeyHex => {
    if (!isString(x)) return false;
    return isHexadecimal(x);
}

// Sha1Hash
export interface Sha1Hash extends String {
    __sha1Hash__: never // phantom type
}
export const isSha1Hash = (x: any) : x is Sha1Hash => {
    if (!isString(x)) return false;
    return isHexadecimal(x, 40); // Sha1 should be 40 hex characters
}

// Signature
export interface Signature extends String {
    __signature__: never
}
export const isSignature = (x: any): x is Signature => {
    if (!isString(x)) return false;
    return isHexadecimal(x, 64);
}


// NodeId
export interface NodeId extends String {
    __nodeId__: never // phantom type
}
export const isNodeId = (x: any): x is NodeId => {
    if (!isString(x)) return false;
    return isHexadecimal(x, 64);
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
    return isHexadecimal(x, 64);
}

// SubfeedHash
export interface SubfeedHash extends String {
    __subfeedHash__: never
}
export const isSubfeedHash = (x: any): x is SubfeedHash => {
    if (!isString(x)) return false;
    return (/^[0-9a-fA-F]{40}?$/.test(x));
}

// FileKey
export interface FileKey {
    sha1: Sha1Hash,
    manifestSha1?: Sha1Hash,
    chunkOf?: {
        fileKey: FileKey,
        startByte: ByteCount,
        endByte: ByteCount
    }
}

export const isFileKey = (x: any): x is FileKey => {
    return _validateObject(x, {
        sha1: isSha1Hash,
        manifestSha1: optional(isSha1Hash),
        chunkOf: optional({
            fileKey: isFileKey,
            startByte: isByteCount,
            endByte: isByteCount
        })
    });
}

// Conversion between types
export const nodeIdToPublicKey = (nodeId: NodeId): PublicKey => {
    // NOTE INCONSISTENCY: Our example keys do not end with a newline, but this function adds one.
    return hexToPublicKey(nodeId.toString() as any as PublicKeyHex);
}
export const feedIdToPublicKeyHex = (feedId: FeedId): PublicKeyHex => {
    return feedId as any as PublicKeyHex;
}
// TODO: Note: PublicKeyHex has no length limit, but nodeId must be 64 characters--> NEED TO ADD 64-char restriction to publickeyhex,privatekeyhex
export const publicKeyHexToNodeId = (x: PublicKeyHex) : NodeId => {
    return x as any as NodeId;
}



// FindLiveFeedResult
export interface FindLiveFeedResult {
    nodeId: NodeId
}
export const isFindLiveFeedResult = (x: any): x is FindLiveFeedResult => {
    return _validateObject(x, {
        nodeId: (a: any) => isNodeId
    });
}

// FindFileResult
export interface FindFileResult {
    nodeId: NodeId,
    fileKey: FileKey,
    fileSize: ByteCount
}
export const isFindFileResult = (x: any): x is FindFileResult => {
    if (!_validateObject(x, {
        nodeId: isNodeId,
        fileKey: isFileKey,
        fileSize: isBigInt
    })) return false;
    return (x.fileSize >= 0);
}


// RequestId
export interface RequestId extends String {
    __requestId__: never // phantom type
}
export const isRequestId = (x: any): x is RequestId => {
    if (!isString(x)) return false;
    return (/^[A-Za-z]{10}$/.test(x));
}
export const createRequestId = () => {
    return randomAlphaString(10) as any as RequestId;
}


export interface ChannelNodeInfoBody {
    channelName: ChannelName,
    nodeId: NodeId,
    httpAddress: Address | null,
    webSocketAddress: Address | null,
    publicUdpSocketAddress: Address | null,
    proxyHttpAddresses: Address[],
    timestamp: Timestamp
}
export const isChannelNodeInfoBody = (x: any): x is ChannelNodeInfoBody => {
    return _validateObject(x, {
        channelName: isChannelName,
        nodeId: isNodeId,
        httpAddress: isOneOf([isNull, isAddress]),
        webSocketAddress: isOneOf([isNull, isAddress]),
        publicUdpSocketAddress: isOneOf([isNull, isAddress]),
        proxyHttpAddresses: isArrayOf(isAddress),
        timestamp: isTimestamp
    })
}

// ChannelNodeInfo
export interface ChannelNodeInfo {
    body: ChannelNodeInfoBody,
    signature: Signature
}
export const exampleAddress: Address = {
    hostName: 'www.flatironinstitute.org' as any as HostName,
    port: 15351 as any as Port,
} as any as Address;
export const exampleChannelNodeInfo: ChannelNodeInfo = {
    body: {
        channelName: 'exampleChannelName' as any as ChannelName,
        nodeId: new Array(65).join('a') as any as NodeId,
        httpAddress: exampleAddress,
        webSocketAddress: null, // todo: should we prefer a non-null value here?
        publicUdpSocketAddress: null,
        proxyHttpAddresses: [exampleAddress],
        timestamp: nowTimestamp()
    },
    signature: new Array(65).join('a') as any as Signature,
}
export const isChannelNodeInfo = (x: any): x is ChannelNodeInfo => {
    return _validateObject(x, {
        body: isChannelNodeInfoBody,
        signature: isSignature
    })
}
_tests.ChannelNodeInfo = () => { assert(isChannelNodeInfo('exampleChannelNodeInfo')) }


// SubfeedMessage
export interface SubfeedMessage extends JSONObject {
    __subfeedMessage__: never;
};
export const exampleSubfeedMessage: SubfeedMessage = {key: 'value'} as any as SubfeedMessage;
export const isSubfeedMessage = (x: any): x is SubfeedMessage => {
    return isObject(x);
}
_tests.SubfeedMessage = () => { assert(isSubfeedMessage(exampleSubfeedMessage)) }


// SubfeedMessageMetaData
export type SubfeedMessageMetaData = Object;
export const exampleSubfeedMessageMetaData: SubfeedMessageMetaData = {metaKey: 'metaValue'} as SubfeedMessageMetaData;
export const isSubfeedMessageMetaData = (x: any): x is SubfeedMessageMetaData => {
    return isObject(x);
}
_tests.SubfeedMessageMetaData = () => { assert(isSubfeedMessageMetaData(exampleSubfeedMessageMetaData)) }


// SignedSubfeedMessage
export interface SignedSubfeedMessage {
    body: {
        previousSignature?: Signature,
        messageNumber: number,
        message: SubfeedMessage,
        timestamp: Timestamp,
        metaData?: SubfeedMessageMetaData
    },
    signature: Signature
}
export const exampleSignedSubfeedMessage: SignedSubfeedMessage = {
    body: {
        previousSignature: new Array(65).join('a') as any as Signature,
        messageNumber: 5,
        message: exampleSubfeedMessage,
        timestamp: nowTimestamp(),
        metaData: exampleSubfeedMessageMetaData
    },
    signature: new Array(65).join('a') as any as Signature,
}
export const isSignedSubfeedMessage = (x: any): x is SignedSubfeedMessage => {
    if (! _validateObject(x, {
        body: {
            previousSignature: optional(isSignature),
            messageNumber: isNumber,
            message: isObject,
            timestamp: isTimestamp,
            metaData: optional(isSubfeedMessageMetaData)
        },
        signature: isSignature
    })) return false;

    // TODO: If this is to be trusted elsewhere (which it will be based on its name & its being a
    // type guard) it's essential we check the signature actually matches the message.
    return true;
}
// Test failing, not quite sure why--I think I did something wrong above
_tests.SignedSubfeedMessage = () => { assert(isSignedSubfeedMessage(exampleSignedSubfeedMessage)) }


// SubmittedSubfeedMessage
export interface SubmittedSubfeedMessage extends JSONObject {
    __submittedSubfeedMessage__: never;
};
export const exampleSubmittedSubfeedMessage: SubmittedSubfeedMessage = { msg: "I am a message "} as any as SubmittedSubfeedMessage;
export const isSubmittedSubfeedMessage = (x: any): x is SubmittedSubfeedMessage => {
    return ((isObject(x)) && (JSON.stringify(x).length < 10000));
}
export const submittedSubfeedMessageToSubfeedMessage = (x: SubmittedSubfeedMessage) => {
    return x as any as SubfeedMessage;
}
_tests.SubmittedSubfeedMessage = () => { assert(isSubmittedSubfeedMessage(exampleSubmittedSubfeedMessage)) }


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
    // TODO: Check those public/private key pairs!
}
export const exampleFeedsConfigFeed: FeedsConfigFeed = { publicKey: "aa" as any as PublicKeyHex, privateKey: "bb" as any as PrivateKeyHex }
_tests.FeedsConfigFeed = () => { assert(isFeedsConfigFeed(exampleFeedsConfigFeed)) }


// FeedName
export interface FeedName extends String {
    __feedName__: never; // phantom
}
export const isFeedName = (x: any): x is FeedName => {
    return isString(x);
}
export const exampleFeedName: FeedName = "My feed name" as any as FeedName;
_tests.FeedName = () => { assert(isFeedName(exampleFeedName)) }


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
        throw Error('Invalid error message: messages cannot exceed 1000 characters.');
    }
}
export const exampleErrorMessage = errorMessage("Nothing's wrong. Everything is fine.");
_tests.ErrorMessage = () => {
    assert(isErrorMessage(exampleErrorMessage));
    try {
        const overlongMessage = new Array(1001).join('#');
        let x = errorMessage(overlongMessage);
        assert(false); // does not occur as error is thrown
    } catch(err) {
        assert(err.message === 'Invalid error message: messages cannot exceed 1000 characters.')
    }
}

// objectToMap and mapToObject
export const objectToMap = <KeyType extends String, ValueType>(obj: {[key: string]: any}) => {
    return new Map<KeyType, ValueType>(Object.keys(obj).map(k => {
        return [k as any as KeyType, obj[k] as any as ValueType];
    }));
}
export const mapToObject = <KeyType extends String, ValueType>(m: Map<KeyType, ValueType>) => {
    const ret: {[key: string]: any} = {};
    m.forEach((v, k) => {
        ret[k.toString()] = v;
    });
    return ret;
}

// TODO: What is this?
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
export const exampleSubfeedAccessDeniedRule = { nodeId: new Array(65).join('a') as any as NodeId, write: false } as SubfeedAccessRule
export const exampleSubfeedAccessAllowedRule = { nodeId: new Array(65).join('a') as any as NodeId, write: true } as SubfeedAccessRule
_tests.SubfeedAccessRule = () => {
    assert(isSubfeedAccessRule(exampleSubfeedAccessDeniedRule));
    assert(isSubfeedAccessRule(exampleSubfeedAccessAllowedRule));
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
_tests.SubfeedAccessRules = () => {
    assert(isArrayOf(isSubfeedAccessRule)([exampleSubfeedAccessAllowedRule, exampleSubfeedAccessDeniedRule]))
}


// SubfeedWatchName
export interface SubfeedWatchName extends String {
    __subfeedWatchName__: never; // phantom
}
export const isSubfeedWatchName = (x: any) => {
    return isString(x);
}
export const exampleSubfeedWatchName = "Example Subfeed Watch Name" as any as SubfeedWatchName;
_tests.SubfeedWatchName = () => { assert(isSubfeedWatchName(exampleSubfeedWatchName)) }


// SubfeedWatch
export interface SubfeedWatch {
    feedId: FeedId,
    subfeedHash: SubfeedHash,
    position: number
    // No name?
}
export const exampleSubfeedWatch: SubfeedWatch = { 
    feedId: new Array(65).join('F') as any as FeedId,
    subfeedHash: new Array(41).join('b') as any as SubfeedHash,
    position: 4
}
export const isSubfeedWatch = (x: any): x is SubfeedWatch => {
    return _validateObject(x, {
        feedId: isFeedId,
        subfeedHash: isSubfeedHash,
        position: isNumber
    });
}
_tests.SubfeedWatch = () => { assert(isSubfeedWatch(exampleSubfeedWatch)) }


// FeedSubfeedId
export interface FeedSubfeedId extends String {
    __feedSubfeedId__: never; // phantom
}
export const feedSubfeedId = (feedId: FeedId, subfeedHash: SubfeedHash): FeedSubfeedId => {
    return (feedId.toString() + ':' + subfeedHash.toString()) as any as FeedSubfeedId; 
}
export const isFeedSubfeedId = (x: any): x is FeedSubfeedId => {
    if (!isString(x)) return false;
    const parts = x.split(':');
    return (parts.length === 2) &&
           (isFeedId(parts[0])) &&
           (isSubfeedHash(parts[1]));
}
export const exampleFeedSubfeedId: FeedSubfeedId = feedSubfeedId(new Array(65).join('F') as any as FeedId, new Array(41).join('b') as any as SubfeedHash);
_tests.FeedSubfeedId = () => {
    assert(isFeedSubfeedId(exampleFeedSubfeedId));
}


// TODO: Skipped this part--want to discuss
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

// LiveFeedSbuscriptionName
export interface LiveFeedSubscriptionName extends String {
    __liveFeedSubscriptionName__: never // phantom type
}
export const isLiveFeedSubscriptionName = (x: any): x is LiveFeedSubscriptionName => {
    if (!isString(x)) return false;
    return (/^[0-9a-zA-Z_\-\. ]{4,160}?$/.test(x));
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
export const exampleLiveFeedSubscription: LiveFeedSubscription = {
    subscriptionName: "This is my subscription" as any as LiveFeedSubscriptionName,
    feedId: new Array(65).join('F') as any as FeedId,
    subfeedHash: new Array(41).join('b') as any as SubfeedHash,
    position: 12
}
_tests.LiveFeedSubscription = () => { assert(isLiveFeedSubscription(exampleLiveFeedSubscription)) }


// LiveFeedSubscriptions
export interface LiveFeedSubscriptions {
    subscriptions: LiveFeedSubscription[]
}
export const isLiveFeedSubscriptions = (x: any): x is LiveFeedSubscriptions => {
    return _validateObject(x, {
        subscriptions: isArrayOf(isLiveFeedSubscription)
    })
}
_tests.LiveFeedSubscriptions = () => { 
    assert(isArrayOf(isLiveFeedSubscription)([exampleLiveFeedSubscription]));
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
export const exampleChannelInfo: ChannelInfo = { nodes: [exampleChannelNodeInfo] } as any as ChannelInfo
_tests.ChannelInfo = () => { assert(isChannelInfo(exampleChannelInfo)) }


export interface MulticastAnnounceMessageBody {
    protocolVersion: ProtocolVersion,
    fromNodeId: NodeId,
    messageType: 'announce', // Should be actual type/enum?
    requestData: AnnounceRequestData
}
export const isMulticastAnnounceMessageBody = (x: any): x is MulticastAnnounceMessageBody => {
    return _validateObject(x, {
        protocolVersion: isProtocolVersion,
        fromNodeId: isNodeId,
        messageType: isEqualTo('announce'),
        requestData: isAnnounceRequestData
    })
}

export interface MulticastAnnounceMessage {
    body: MulticastAnnounceMessageBody,
    signature: Signature
}
export const isMulticastAnnounceMessage = (x: any): x is MulticastAnnounceMessage => {
    return _validateObject(x, {
        body: isMulticastAnnounceMessageBody,
        signature: isSignature
    })
}
export const exampleMulticastAnnounceMessage: MulticastAnnounceMessage = {
    body: {
        protocolVersion: "valid example protocol" as any as ProtocolVersion,
        fromNodeId: new Array(65).join('a') as any as NodeId,
        messageType: 'announce',
        requestData: {  // TODO: This should be standardized; and we are growing toward a weird cross-import situation.
            requestType: 'announce',
            channelNodeInfo: exampleChannelNodeInfo
        }
    },
    signature: new Array(65).join('a') as any as Signature
}
_tests.MulticastAnnounceMessage = () => {
    assert(isMulticastAnnounceMessage(exampleMulticastAnnounceMessage));
}


export const jsonObjectsMatch = (x1: any, x2: any): boolean => {
    if (!isJSONObject(x1)) throw Error('x1 is not a json object in jsonObjectsMatch');
    if (!isJSONObject(x2)) throw Error('x2 is not a json object in jsonObjectsMatch');
    return (JSONStringifyDeterministic(x1) === JSONStringifyDeterministic(x2));
}