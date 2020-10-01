import assert from 'assert'
import { hexToPublicKey, JSONStringifyDeterministic } from "../common/crypto_util";
import { randomAlphaString } from "../common/util";
import { AnnounceRequestData, isAnnounceRequestData, isAnnounceResponseData } from "./NodeToNodeRequest";

export const _tests: {[key: string]: Function} = {}

export interface ProtocolVersion extends String {
    __protocolVersion__: never // phantom type
}
export const exampleProtocolVersion: ProtocolVersion = "example-protocol.Version" as any as ProtocolVersion
export const isProtocolVersion = (x: any): x is ProtocolVersion => {
    if (!isString(x)) return false;
    return (/^[0-9a-zA-z.\ \-]{4,30}?$/.test(x));
}
_tests.ProtocolVersion = () => {
    assert(isProtocolVersion(exampleProtocolVersion))
}

export interface DaemonVersion extends String {
    __daemonVersion__: never // phantom
}
export const exampleDaemonVersion: DaemonVersion = "example-daemon.Version" as any as DaemonVersion
export const isDaemonVersion = (x: any): x is DaemonVersion => {
    if (!isString(x)) return false;
    return (/^[0-9a-zA-z\.\ \-]{4,40}?$/.test(x));
}
_tests.DaemonVersion = () => {
    assert(isDaemonVersion(exampleDaemonVersion))
}

export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONObject | JSONArray;
export type JSONObject = { [member: string]: JSONValue };
export interface JSONArray extends Array<JSONValue> {}
export const isJSONObject = (x: any): x is JSONObject => {
    if (!isObject(x)) return false;
    return isJSONSerializable(x);
}
export const exampleJSONObject = {example: ['json', {object: 1}, '---']}
export const exampleSerializedJSONObject = JSON.stringify(exampleJSONObject);
export const tryParseJsonObject = (x: string): JSONObject | null => {
    let a: any;
    try {
        a = JSON.parse(x);
    }
    catch {
        return null;
    }
    if (!isJSONObject(a)) return null;
    return a;
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
_tests.isJSONObject = () => {
    assert(isJSONObject(exampleJSONObject))
}
_tests.isJSONSerializable = () => {
    assert(isJSONSerializable(exampleJSONObject))
}
_tests.tryParseJsonObject = () => {
    const obj = tryParseJsonObject(exampleSerializedJSONObject)
    assert(!isNull(obj))
}

// object
export const isObject = (x: any): x is Object => {
    return ((x !== null) && (typeof x === 'object'));
}
_tests.testIsObjectAcceptsObject = () => {
    assert(isObject({name: 'Object', type: 'Object', value: 5}))
}
_tests.testIsObjectRejectsNonObject = () => {
    assert(!isObject('I am a string'))
}

// string
export const isString = (x: any): x is string => {
    return ((x !== null) && (typeof x === 'string'));
}
_tests.testIsStringAcceptsString = () => {
    assert(isString("5"));
}
_tests.testIsStringRejectsNonString = () => {
    assert(!isString(5))
}

// function
const isFunction = (x: any): x is Function => {
    return ((x !== null) && (typeof x === 'function'));
}
_tests.testIsFunctionAcceptsFunction = () => {
    assert(isFunction(_tests.testIsStringAcceptsString))
}
_tests.testIsFunctionRejectsNonFunction = () => {
    assert(!isFunction({object: 'yes', function: () => 5}))
}

// number
export const isNumber = (x: any): x is number => {
    return ((x !== null) && (typeof x === 'number'));
}
_tests.testIsNumberAcceptsNumber = () => {
    assert(isNumber(5.432))
}
_tests.testIsNumberRejectsNonNumber = () => {
    assert(!isNumber("5"))
}

// bigint
export const isBigInt = (x: any): x is bigint => {
    return ((x !== null) && (typeof x === 'bigint'));
}
_tests.testIsBigIntAcceptsBigInt = () => {
    assert(isBigInt(BigInt(5)))
}
_tests.testIsBigIntRejectsNonBigInt = () => {
    assert(!isBigInt(5))
}

// null
export const isNull = (x: any): x is null => {
    return x === null;
}
_tests.testIsNullAcceptsNull = () => { assert(isNull(null)) }
_tests.testIsNullRejectsNonNull = () => { assert(!isNull("null")) }

// boolean
export const isBoolean = (x: any): x is boolean => {
    return ((x !== null) && (typeof x === 'boolean'));
}
_tests.testIsBooleanAcceptsBoolean = () => { assert(isBoolean(false)) }
_tests.testIsBooleanRejectsNonBoolean = () => { assert(!isBoolean('false')) }

// isOneOf
export const isOneOf = (testFunctions: Function[]): ((x: any) => boolean) => {
    return (x) => {
        for (let tf of testFunctions) {
            if (tf(x)) return true;
        }
        return false;
    }
}
_tests.testIsOneOf = () => {
    const checker = isOneOf([isBoolean, isString]);
    assert(checker('I am a string'));
    assert(checker(false));
    assert(!checker(5));
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
            return _validateObject(x, obj)
        }
    }   
}
// TODO

// isEqualTo
export const isEqualTo = (value: any): ((x: any) => boolean) => {
    return (x) => {
        return x === value;
    }
}
_tests.testIsEqualTo = () => {
    const isMyString = isEqualTo('myString');
    assert(isMyString('myString'));
    assert(!isMyString('MyString'));
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
_tests.testIsArrayOf = () => {
    const areStrings = isArrayOf(isString);
    assert(areStrings(['these', 'are', 'strings']));
    assert(!areStrings('not an array'));
    assert(!areStrings(['These', 'are', 'not', 5, 'strings']));
}

//***** NOTE: The "key" test should not be needed here; Javascript converts all keys to strings
//***** See comments in the tests below
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
_tests.testIsObjectOf = () => {
    const isStringKeyedInts = isObjectOf(isString, isBigInt);
    assert(isStringKeyedInts({'one': BigInt(4), 'Two': BigInt(5)}));
    // assert(!isStringKeyedInts({1: BigInt(1), 2: BigInt(2)})); // this FAILS: any key is automatically converted to a string
    assert(!isStringKeyedInts({'one': 1, 'two': 3.4}));
}

// NOTE: Failing test to address issue with this function
_tests.testIsObjectOfForNumberKeys = () => {
    const isNumberKeyedNumber = isObjectOf(isNumber, isNumber);
    assert(isNumberKeyedNumber({9: 5, 3.14: 159 }));
}


// Port
export interface Port extends Number {
    __port__: never
}
export const examplePort: Port = 1000 as any as Port
export const isPort = (x: any) : x is Port => {
    if (!isNumber(x)) return false;
    return x > 0 && x < 65536; // port numbers must be in 16-bit positive range
}
export const toNumber = (x: Port): number => {
    return x as any as number;
}
_tests.Port = () => {
    assert(isPort(examplePort));
    assert(!isPort(-1000)); // negative
    assert(!isPort('abc')); // not actually a number
    assert(!isPort(65536)); // too large
}

// HostName
export interface HostName extends String {
    __hostName__: never
}
export const exampleHostName: HostName = '0.0.0.0' as any as HostName
export const isHostName = (x: any): x is HostName => {
    if (!isString(x)) return false;
    return (/^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/.test(x));
}
_tests.HostName = () => {
    assert(isHostName(exampleHostName))
}

// Address
export interface Address {
    hostName: HostName,
    port: Port
}
export const exampleAddress = {
    hostName: exampleHostName,
    port: examplePort
}
export const isAddress = (x: any): x is Address => {
    return _validateObject(x, {
        hostName: isHostName,
        port: isPort
    });
}
_tests.Address = () => {
    assert(isAddress(exampleAddress))
}

// TimeStamp
export interface Timestamp extends Number {
    __timestamp__: never
}
export const exampleTimestamp: Timestamp = Number(new Date(2020, 1, 1, 1, 1, 1, 0)) - 0 as any as Timestamp
export const isTimestamp = (x: any) : x is Timestamp => {
    if (!isNumber(x)) return false;
    if (x < 0) return false;  // For our purposes, timestamps should never be negative
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
_tests.Timestamp = () => {
    assert(isTimestamp(exampleTimestamp));
    assert(isTimestamp(50));
    assert(!isTimestamp(-50));
}
_tests.ZeroTimeStamp = () => {
    assert(0 == (zeroTimestamp() as any as number));
    assert(isTimestamp(zeroTimestamp())); // make sure 0 is accepted
}
_tests.ElapsedSince = () => {
    const time = nowTimestamp();
    const newTime = ((time as any as number) - 5) as any as Timestamp; // manually set back the clock 5 ms
    const diff = elapsedSince(newTime); // should always yield 5, since these operations take <1 ms
    assert(diff === 5 || diff === 6); // just in case we hit a ms boundary
}

// PublicKey
export interface PublicKey extends String {
    __publicKey__: never // phantom type so that we cannot assign directly to a string
}
const examplePublicKey: PublicKey = '-----BEGIN PUBLIC KEY-----\nPUBLICKEYAAAAAAAAAAADt4+bJGhgtv/oQvPS03eZrEL8vYBXo0j3D7mNUM=\n-----END PUBLIC KEY-----' as any as PublicKey
export const isPublicKey = (x: any) : x is PublicKey => {
    if (!isString(x)) return false;
    // TODO: Is there a specific length of the key block?
    return (/^-----BEGIN PUBLIC KEY-----[\s\S]*-----END PUBLIC KEY-----$/.test(x));
}
_tests.PublicKey = () => { assert(isPublicKey(examplePublicKey)) }

// PrivateKey
export interface PrivateKey extends String {
    __privateKey__: never // phantom type
}
const examplePrivateKey: PrivateKey = '-----BEGIN PRIVATE KEY-----\nPRIVATEKEYAAAAAAAAAADt4+bJGhgtv/oQvPS03eZrEL8vYBXo0j3D7mNUM=\n-----END PRIVATE KEY-----' as any as PrivateKey
export const isPrivateKey = (x: any) : x is PublicKey => {
    if (!isString(x)) return false;
    // TODO: Is there a specific length of the key block?
    return (/^-----BEGIN PRIVATE KEY-----[\s\S]*-----END PRIVATE KEY-----$/.test(x));
}
_tests.PrivateKey = () => { assert(isPrivateKey(examplePrivateKey)) }

// PublicKeyHex
export interface PublicKeyHex extends String {
    __publicKeyHex__: never // phantom type so that we cannot assign directly to a string
}
const examplePublicKeyHex: PublicKeyHex = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as any as PublicKeyHex
export const isPublicKeyHex = (x: any) : x is PublicKeyHex => {
    if (!isString(x)) return false;
    return (/^[0-9a-fA-F]+$/.test(x));
}
_tests.PublicKeyHex = () => { assert(isPublicKeyHex(examplePublicKeyHex)) }

// PrivateKeyHex
export interface PrivateKeyHex extends String {
    __privateKeyHex__: never // phantom type
}
const examplePrivateKeyHex: PrivateKeyHex = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as any as PrivateKeyHex
export const isPrivateKeyHex = (x: any) : x is PrivateKeyHex => {
    if (!isString(x)) return false;
    return (/^[0-9a-fA-F]+$/.test(x));
}
_tests.PrivateKeyHex = () => { assert(isPrivateKeyHex(examplePrivateKeyHex)) }

// Sha1Hash
export interface Sha1Hash extends String {
    __sha1Hash__: never // phantom type
}
const exampleSha1Hash: Sha1Hash = '63a0f8f44232cba2eca23dea7baa4e176b93e957' as any as Sha1Hash
export const isSha1Hash = (x: any) : x is Sha1Hash => {
    if (!isString(x)) return false;
    return (/^[0-9a-fA-F]{40}$/.test(x));  // Sha1 hash must be 40 hexadecimal characters
}
_tests.Sha1Hash = () => { assert(isSha1Hash('63a0f8f44232cba2eca23dea7baa4e176b93e957')) }


// TODO: IS THIS ACTUALLY A PUBLIC KEY? 
export const nodeIdToPublicKey = (nodeId: NodeId): PublicKey => {
    return hexToPublicKey(nodeId.toString() as any as PublicKeyHex);
}

// KeyPair
export interface KeyPair {
    publicKey: PublicKey,
    privateKey: PrivateKey
}
const exampleKeyPair: KeyPair = {
    publicKey: examplePublicKey,
    privateKey: examplePrivateKey
}
// TODO: did I do this right?
export const isKeyPair = (x: any) : x is KeyPair => {
    return _validateObject(x, {
        publicKey: (a: any) => (isPublicKey(a)),
        privateKey: (a: any) => (isPrivateKey(a))
    });
    // TODO: if we trust this function for anything serious, it *REALLY* ought to confirm that the keypair matches
}
_tests.IsKeyPair = () => { assert(false) } // Failing test to address above issue


// Signature
export interface Signature extends String {
    __signature__: never
}
export const exampleSignature: Signature = 'abc000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as any as Signature
export const isSignature = (x: any): x is Signature => {
    if (!isString(x)) return false;
    return (/^[0-9a-f]{64}?$/.test(x));
}
_tests.Signature = () => { assert(isSignature(exampleSignature)) }


// NodeId
export interface NodeId extends String {
    __nodeId__: never // phantom type
}
export const exampleNodeId: NodeId = 'abc123aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as any as NodeId
export const isNodeId = (x: any): x is NodeId => {
    if (!isString(x)) return false;
    return (/^[0-9a-f]{64}?$/.test(x));
}
_tests.NodeId = () => { assert(isNodeId(exampleNodeId)) }

// ChannelName
export interface ChannelName extends String {
    __channelName__: never // phantom type
}
export const exampleChannelName: ChannelName = 'example.Channel-Name' as any as ChannelName
export const isChannelName = (x: any): x is ChannelName => {
    if (!isString(x)) return false;
    return (/^[0-9a-zA-Z_\-\.]{4,160}?$/.test(x));
}
_tests.ChannelName = () => { assert(isChannelName(exampleChannelName)) }

// FeedId
export interface FeedId extends String {
    __feedId__: never // phantom type
}
export const exampleFeedId: FeedId = '0123456789abcdef0123456789ABCDEF0123456789abcdef0123456789ABCDEF' as any as FeedId
export const isFeedId = (x: any): x is FeedId => {
    if (!isString(x)) return false;
    return (/^[0-9a-fA-F]{64}?$/.test(x));
}
_tests.FeedId = () => { assert(isFeedId(exampleFeedId)) }

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
export const exampleSubfeedHash: SubfeedHash = '0123456789abcdefABCD9876543210FEDCBAedcb' as any as SubfeedHash;
export const isSubfeedHash = (x: any): x is SubfeedHash => {
    if (!isString(x)) return false;
    return (/^[0-9a-fA-F]{40}?$/.test(x));
}
_tests.SubfeedHash = () => { assert(isSubfeedHash(exampleSubfeedHash)) }


// FileKey
export interface FileKey {
    sha1: Sha1Hash,
    chunkOf?: {
        fileKey: FileKey,
        startByte: bigint,
        endByte: bigint
    }
}
export const exampleFileKey: FileKey = {
    sha1: exampleSha1Hash,
    chunkOf: {
        fileKey: {
            sha1: exampleSha1Hash
        },
        startByte: BigInt(0), // not recognized when targeting versions below es2020
        endByte: BigInt(100)
    }
}
export const isFileKey = (x: any): x is FileKey => {
    return _validateObject(x, {
        sha1: (a: any) => (isString(a) && /^[0-9a-fA-F]{40}?$/.test(a)),
        chunkOf: optional({
            fileKey: isFileKey,
            startByte: isBigInt,
            endByte: isBigInt
        })
    });
}
_tests.FileKey = () => { assert(isFileKey(exampleFileKey)) }


// FindLiveFeedResult
export interface FindLiveFeedResult {
    nodeId: NodeId
}
export const exampleFindLiveFeedResult: FindLiveFeedResult = { nodeId: exampleNodeId }
export const isFindLiveFeedResult = (x: any): x is FindLiveFeedResult => {
    return _validateObject(x, {
        nodeId: (a: any) => isNodeId
    });
}
_tests.FindLiveFeedResult = () => { assert(isFindLiveFeedResult(exampleFindLiveFeedResult)) }


export interface ChannelNodeInfoBody {
    channelName: ChannelName,
    nodeId: NodeId,
    httpAddress: Address | null,
    webSocketAddress: Address | null,
    udpAddress: Address | null,
    proxyHttpAddresses: Address[],
    timestamp: Timestamp
}
export const isChannelNodeInfoBody = (x: any): x is ChannelNodeInfoBody => {
    return _validateObject(x, {
        channelName: isChannelName,
        nodeId: isNodeId,
        httpAddress: isOneOf([isNull, isAddress]),
        webSocketAddress: isOneOf([isNull, isAddress]),
        udpAddress: isOneOf([isNull, isAddress]),
        proxyHttpAddresses: isArrayOf(isAddress),
        timestamp: isTimestamp
    })
}

// ChannelNodeInfo
export interface ChannelNodeInfo {
    body: ChannelNodeInfoBody,
    signature: Signature
}
export const exampleChannelNodeInfo: ChannelNodeInfo = {
    body: {
        channelName: exampleChannelName,
        nodeId: exampleNodeId,
        httpAddress: exampleAddress,
        webSocketAddress: null, // todo: should we prefer a non-null value here?
        udpAddress: null, // todo: should we prefer a non-null value here?
        proxyHttpAddresses: [exampleAddress],
        timestamp: nowTimestamp()
    },
    signature: exampleSignature
}
export const isChannelNodeInfo = (x: any): x is ChannelNodeInfo => {
    return _validateObject(x, {
        body: isChannelNodeInfoBody,
        signature: isSignature
    })
}
_tests.ChannelNodeInfo = () => { assert(isChannelNodeInfo(exampleChannelNodeInfo)) }


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
        previousSignature: Signature,
        messageNumber: number,
        message: SubfeedMessage,
        timestamp: Timestamp,
        metaData?: SubfeedMessageMetaData
    },
    signature: Signature
}
export const exampleSignedSubfeedMessage: SignedSubfeedMessage = {
    body: {
        previousSignature: exampleSignature,
        messageNumber: 5,
        message: exampleSubfeedMessage,
        timestamp: nowTimestamp(),
        metaData: exampleSubfeedMessageMetaData
    },
    signature: exampleSignature
}
export const isSignedSubfeedMessage = (x: any): x is SignedSubfeedMessage => {
    if (! _validateObject(x, {
        body: {
            previousSignature: isSignature,
            messageNumber: isNumber,
            message: isObject,
            timestamp: isTimestamp,
            // metaData: optional({ isSubfeedMessageMetaData }) // does this work?
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
export const exampleFeedsConfigFeed: FeedsConfigFeed = { publicKey: examplePublicKeyHex, privateKey: examplePrivateKeyHex }
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
        // todo: ought to be some neat trick to put this in a variable and refer to it, but oh well.
        assert(err.message === 'Invalid error message: messages cannot exceed 1000 characters.')
    }
}

// TODO: Want to discuss this
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
// Failing test: reminder to fix the FeedsConfig, FeedsConfigRAM area
_tests.FeedsConfig = () => { assert(false); }


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
export const exampleSubfeedAccessDeniedRule = { nodeId: exampleNodeId, write: false } as SubfeedAccessRule
export const exampleSubfeedAccessAllowedRule = { nodeId: exampleNodeId, write: true } as SubfeedAccessRule
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
    feedId: exampleFeedId,
    subfeedHash: exampleSubfeedHash,
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
export const exampleFeedSubfeedId: FeedSubfeedId = feedSubfeedId(exampleFeedId, exampleSubfeedHash);
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

// FindFileResult
export interface FindFileResult {
    nodeId: NodeId,
    fileKey: FileKey,
    fileSize: bigint
}
export const isFindFileResult = (x: any): x is FindFileResult => {
    return _validateObject(x, {
        nodeId: isNodeId,
        fileKey: isFileKey,
        fileSize: isBigInt
    });
}
export const exampleFindFileResult: FindFileResult = {
    nodeId: exampleNodeId,
    fileKey: exampleFileKey,
    fileSize: BigInt(20)
}
// TODO: This is failing and I'm not sure why
_tests.FindFileResult = () => { assert(isFindFileResult(exampleFindFileResult)) }


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
_tests.RequestId = () => { assert(isRequestId(createRequestId())); }

// ChannelName
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
    feedId: exampleFeedId,
    subfeedHash: exampleSubfeedHash,
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
        protocolVersion: exampleProtocolVersion,
        fromNodeId: exampleNodeId,
        messageType: 'announce',
        requestData: {  // TODO: This should be standardized; and we are growing toward a weird cross-import situation.
            requestType: 'announce',
            channelNodeInfo: exampleChannelNodeInfo
        }
    },
    signature: exampleSignature
}
_tests.MulticastAnnounceMessage = () => {
    assert(isMulticastAnnounceMessage(exampleMulticastAnnounceMessage));
}


export const jsonObjectsMatch = (x1: any, x2: any): boolean => {
    if (!isJSONObject(x1)) throw Error('x1 is not a json object in jsonObjectsMatch');
    if (!isJSONObject(x2)) throw Error('x2 is not a json object in jsonObjectsMatch');
    return (JSONStringifyDeterministic(x1) === JSONStringifyDeterministic(x2));
}