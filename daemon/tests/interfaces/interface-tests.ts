import { expect } from 'chai' // test library
import * as mocha from 'mocha' // import types for mocha e.g. describe
import { hexToPublicKey } from '../../src/common/crypto_util'
import * as ut from '../../src/interfaces/core'
import { AnnounceRequestData } from '../../src/interfaces/NodeToNodeRequest'

// Utility string manipulation
const shorterByOne = (x: string): string => { return x.substring(1, x.length) }
const extendByValidChar = (x: string): string => { return x + x.substring(0, 1) }
const replaceInitialWithChar = (x: string, char: string): string => { return char + x.substring(1, x.length) }

// Example objects (test fixtures)
const validChannelName: ut.ChannelName = 'example.Channel-Name' as any as ut.ChannelName
const validNodeId: ut.NodeId = new Array(65).join('a') as any as ut.NodeId
const validFeedId: ut.FeedId = new Array(65).join('F') as any as ut.FeedId
const validSubfeedHash: ut.SubfeedHash = new Array(41).join('b') as any as ut.SubfeedHash
const validSha1Hash: ut.Sha1Hash = new Array(41).join('5') as any as ut.Sha1Hash
const validHostName: ut.HostName = 'www.flatironinstitute.org' as any as ut.HostName
const validSignature: ut.Signature = new Array(129).join('1') as any as ut.Signature
const validFileKey: ut.FileKey = {
    sha1: validSha1Hash,
    chunkOf: {
        fileKey: { sha1: validSha1Hash },
        startByte: 0 as any as ut.ByteCount,
        endByte: 100 as any as ut.ByteCount
    }
}
// yeah, exporting this is not a great idea... TODO
export const validNodeInfoBody: ut.ChannelNodeInfoBody = {
    channelName: validChannelName,
    nodeId: validNodeId,
    nodeLabel: ut.nodeLabel('label'),
    httpAddress: { hostName: validHostName, port: 80 as any as ut.Port },
    webSocketAddress: { hostName: validHostName, port: 212 as any as ut.Port },
    publicUdpSocketAddress: { hostName: validHostName, port: 443 as any as ut.Port },
    proxyWebsocketNodeIds: [],
    isMessageProxy: false,
    isDataProxy: false,
    timestamp: ut.nowTimestamp()
}
const validChannelNodeInfo: ut.ChannelNodeInfo = {
    body: validNodeInfoBody,
    signature: validSignature
}

 // need to explicitly use mocha prefix once or the dependency gets wrongly cleaned up
mocha.describe('Basic type guards', () => {
    describe('JSON Handling', () => {
        // Test fixture for JSON object handling
        const exampleJSONObject = {example: ['json', {object: 1}, '---']}

        it('JSON object successfully recognized', () => {
            expect(ut.isJSONObject(exampleJSONObject)).to.be.true
        })
        it('isJSONObject() returns false for non-object input', () => {
            expect(ut.isJSONObject('string')).to.be.false
        })
        it('JSON object parsed successfully', () => {
            const obj = ut.tryParseJsonObject(JSON.stringify(exampleJSONObject))
            expect(obj).to.deep.equal(exampleJSONObject)
        })
        it('JSON object recognized as serializable', () => {
            expect(ut.isJSONSerializable(exampleJSONObject)).to.be.true
        })
        it('isJSONSerializable() returns false on non-object input', () => {
            expect(ut.isJSONSerializable("string input")).to.be.false
        })
        it('isJSONSerializable() returns false on non-plain input', () => {
            expect(ut.isJSONSerializable(new Map())).to.be.false
        })
        it('isJSONSerializable() returns false on non-plain property', () => {
            expect(ut.isJSONSerializable( { map: new Map() } )).to.be.false
        })
        it('isJSONSerializable() returns false on non-serializable property', () => {
            expect(ut.isJSONSerializable( { outerKey: { key: new Date() }} )).to.be.false
        })
        it('TryParse returns null without throwing on parse failure', () => {
            expect(ut.tryParseJsonObject('This is not json')).to.be.null
        })
        // The following is just to create a situation where isJSONSerializable has actual inherited properties to test.
        // It gets us one additional line of code coverage. It would not be unreasonable to remove it.
        interface MyParent { key: string }
        interface MyChild extends MyParent { key2: string }
        const MyParent = function(this: MyParent) { this.key = 'value' } as any 
        const MyChild = function(this: MyChild) { MyParent.call(this); this.key2 = 'value2' } as any
        MyChild.prototype = Object.create(MyParent.prototype)
        MyChild.prototype.constructor = MyChild
        let kid = new MyChild()
        it('isJSONSerializable() skips checking inherited-property serializability', () => {
            expect(ut.isJSONSerializable(kid)).to.be.true
        })
    })
    describe('Object handling', () => {
        it('isObject() returns true on valid object input', () => {
            expect(ut.isObject({name: 'Object', type: 'Object', value: 5})).to.be.true
        })
        it('isObject() returns false on non-object input', () => {
            expect(ut.isObject('I am a string')).to.be.false
        })
    })
    describe('String handling', () => {
        it('isString() returns true on string input', () => {
            expect(ut.isString("5")).to.be.true
        })
        it('isString() returns false on non-string input', () => {
            expect(ut.isString(5)).to.be.false
        })
    })
    describe('Function handling', () => {
        it('isFunction() returns true on function input', () => {
            expect(ut.isFunction(() => 5)).to.be.true
        })
        it('isFunction() returns false on non-function input', () => {
            expect(ut.isFunction(5)).to.be.false
        })
    })
    describe('Number handling', () => {
        it('isNumber() returns true on number input', () => {
            expect(ut.isNumber(5.432)).to.be.true
            expect(ut.isNumber(-783)).to.be.true
        })
        it('isNumber() returns false on non-numeric input', () => {
            expect(ut.isNumber('5')).to.be.false
        })
    })
    describe('Null handling', () => {
        it('isNull() returns true on null input', () => {
            expect(ut.isNull(null)).to.be.true
        })
        it('isNull() returns false on non-null input', () => {
            expect(ut.isNull(5)).to.be.false
        })
    })
    describe('Boolean handling', () => {
        it('isBoolean() returns true on boolean input', () => {
            expect(ut.isBoolean(true)).to.be.true
            expect(ut.isBoolean(false)).to.be.true
            expect(ut.isBoolean(5 === 5)).to.be.true
            expect(ut.isBoolean('a' === 'a')).to.be.true
        })
        it('isBoolean() returns false on non-boolean input', () => {
            expect(ut.isBoolean('false')).to.be.false
        })
    })
})

describe('Utility comparisons', () => {
    describe('Hexadecimal-checking method', () => {
        it('isHexadecimal() returns true for hex string', () => {
            expect(ut.isHexadecimal('0123456789abcdefABCDEF')).to.be.true
        })
        it('isHexadecimal() returns true for hex string of correct length', () => {
            expect(ut.isHexadecimal('12345abcde', 10)).to.be.true
        })
        it('isHexadecimal() returns false for non-hex characters', () => {
            expect(ut.isHexadecimal('*%+$qwrtyzxv')).to.be.false
        })
        it('isHexadecimal() returns false for bad length', () => {
            expect(ut.isHexadecimal('12345', 10)).to.be.false
            expect(ut.isHexadecimal('1234567890', 5)).to.be.false
        })
    })
    const checker = ut.isOneOf([ut.isBoolean, ut.isString])
    describe('Type union', () => {
        it('isOneOf() recognizes all enumerated types', () => {
            expect(checker('I am a string')).to.be.true
            expect(checker(false)).to.be.true
        })
        it('isOneOf() returns false on non-included types', () => {
            expect(checker(5)).to.be.false
        })
    })
    describe('Optional: function arguments', () => {
        const optionalStringChecker = ut.optional(ut.isString)
        it('optional() checker returns true when passed undefined', () => {
            expect(optionalStringChecker(undefined)).to.be.true
        })
        it('optional() checker returns true when passed a matching value', () => {
            expect(optionalStringChecker('string')).to.be.true
        })
        it('optional() checker returns false when passed null', () => {
            expect(optionalStringChecker(null)).to.be.false
        })
        it('optional() checker returns false when passed wrong type', () => {
            expect(optionalStringChecker(5)).to.be.false
        })
    })
    describe('Optional: ValidateObjectSpec arguments', () => {
        const objectSpec: ut.ValidateObjectSpec = { myString: ut.isString }
        const optionalSpecChecker = ut.optional(objectSpec)
        it('optional() spec checker returns true when passed undefined', () => {
            expect(optionalSpecChecker(undefined)).to.be.true
        })
        it('optional() spec checker returns false when passed null', () => {
            expect(optionalSpecChecker(null)).to.be.false
        })
        it('optional() spec checker returns true when object matches spec', () => {
            expect(optionalSpecChecker({ myString: 'foo' })).to.be.true
        })
        it('optional() spec checker returns false when object does not match spec', () => {
            expect(optionalSpecChecker({ notMyString: 'foo' })).to.be.false
        })
    })
    describe('Equality check', () => {
        const isMyString = ut.isEqualTo('myString')
        it('isEqualTo() returns true on equality', () => {
            expect(isMyString('myString')).to.be.true
        })
        it('isEqualTo() returns false on non-equality', () => {
            expect(isMyString('not my string')).to.be.false
        })
    })
    describe('Array check', () => {
        const areStrings = ut.isArrayOf(ut.isString)
        it('isArrayOf() returns true on array of specified type', () => {
            expect(areStrings(['These', 'are', 'four', 'strings'])).to.be.true
        })
        it('isArrayOf() returns false on non-array', () => {
            expect(areStrings('This is not an array')).to.be.false
        })
        it('isArrayOf() returns false on wrongly-typed members', () => {
            expect(areStrings(['These', 'are', 'not', 5, 'strings'])).to.be.false
        })
    })
    describe('Object validation to spec', () => {
        const objectSpec: ut.ValidateObjectSpec = { myObj: { myString: ut.isString }, myNum: ut.isNumber }
        const matchingObject = { myObj: { myString: 'string' }, myNum: 5 }
        let cb_msg = ''
        const cb = (x: string) => { cb_msg = x }
        it('_validateObject() returns true on correctly formatted object', () => {
            expect(ut._validateObject(matchingObject, objectSpec)).to.be.true
        })
        it('_validateObject() returns false on extra key', () => {
            expect(ut._validateObject({ ...matchingObject, newKey: 'bar' }, objectSpec)).to.be.false
        })
        it('_validateObject() calls callback on extra key', () => {
            ut._validateObject({ ...matchingObject, newKey: 'bar' }, objectSpec, cb)
            expect(cb_msg).to.equal('Key not in spec: newKey')
        })
        it('_validateObject() returns false on wrong-typed value', () => {
            expect(ut._validateObject({ ...matchingObject, myNum: 'five' }, objectSpec)).to.be.false
        })
        it('_validateObject() calls callback on wrong-typed value', () => {
            ut._validateObject({ ...matchingObject, myNum: 'five' }, objectSpec, cb)
            expect(cb_msg).to.equal('Problem validating: myNum')
        })
        it('_validateObject() returns false on missing key', () => {
            const objectMissingKey = { myNum: 5 }
            expect(ut._validateObject(objectMissingKey, objectSpec)).to.be.false
        })
        it('_validateObject() calls callback on missing key', () => {
            const objectMissingKey = { myNum: 5 }
            ut._validateObject(objectMissingKey, objectSpec, cb)
            expect(cb_msg).to.equal('Key not in x: myObj')
        })
        it('_validateObject() returns false on sub-spec validation failure', () => {
            const subObjectHasBadType = { myObj: { myString: 5 }, myNum: 5}
            expect(ut._validateObject(subObjectHasBadType, objectSpec)).to.be.false
        })
        it('_validateObject() calls callback on sub-spec validation failure', () => {
            const subObjectHasBadType = { myObj: { myString: 5 }, myNum: 5}
            ut._validateObject(subObjectHasBadType, objectSpec, cb)
            expect(cb_msg).to.equal('Value of key > myObj < itself failed validation.')
        })
    })
    describe('Object-Map Translation', () => {
        let myObj = { 'first': 1, 'second': 2 }
        let myMap = new Map<string, number>();
        myMap.set('first', 1)
        myMap.set('second',2)
        const areEqual = (obj: {[key: string]: any}, map: Map<string, number>): boolean => {
            for (let k in obj) if(obj[k] !== map.get(k)) return false
            for (let k in map.keys()) if (map.get(k) !== obj[k]) return false
            return true
        }
        it('objectToMap() is identity function', () => {
            const ret = ut.objectToMap<string, number>(myObj)
            expect(areEqual(myObj, ret)).to.be.true
            expect(ret).to.deep.equal(myMap)
        })
        // it('objectToMap() returns exclusively objects of desired type', () => { })
        it('mapToObject() is identity function', () => {
            const ret = ut.mapToObject<string, number>(myMap)
            expect(areEqual(ret, myMap)).to.be.true
            expect(ret).to.deep.equal(myObj)
        })
        // it('mapToObject() returns JSON-parsable object', () => { })
    })
    describe('JSON Objects Match utility function', () => {
        const obj1 = { a: 'value', b: 5 }
        const obj2 = { a: 'value', b: '5' }
        const obj3 = { wrongKey: 'value' }
        it('jsonObjectsMatch() returns true for identity object', () => {
            expect(ut.jsonObjectsMatch(obj1, obj1)).to.be.true
        })
        it('jsonObjectsMatch() returns false on non-matching objects', () => {
            expect(ut.jsonObjectsMatch(obj1, obj2)).to.be.false
            expect(ut.jsonObjectsMatch(obj1, obj3)).to.be.false
        })
        it('jsonObjectsMatch() throws if either object is non-JSON object', () => {
            const badCall1 = () => { ut.jsonObjectsMatch(obj1, 5) }
            const badCall2 = () => { ut.jsonObjectsMatch(null, obj1) }
            expect(badCall1).to.throw()
            expect(badCall2).to.throw()
        })
    })
})

describe('Versioning types', () => {
    describe('Protocol Version', () => {
        it('isProtocolVersion() returns true on valid input', () => {
            expect(ut.isProtocolVersion('example-protocol.Version')).to.be.true
        })
        it('isProtocolVersion() returns false on non-string input', () => {
            expect(ut.isProtocolVersion(5)).to.be.false
        })
        it('isProtocolVersion() returns false on over-long input', () => {
            // join inserts between each element -- array needs to be 2 bigger than allowed value
            expect(ut.isProtocolVersion(new Array(32).join('a'))).to.be.false
        })
        it('isProtocolVersion() returns false on too-short input', () => {
            expect(ut.isProtocolVersion('')).to.be.false
            expect(ut.isProtocolVersion('abc')).to.be.false
        })
        it('isProtocolVersion() returns false on bad characters', () => {
            expect(ut.isProtocolVersion('#example-protocol.Version')).to.be.false
        })
    })
    describe('Daemon Version', () => {
        it('isDaemonVersion() returns true on valid input', () => {
            expect(ut.isDaemonVersion('example-daemon.Version')).to.be.true
        })
        it('isDaemonVersion() returns false on non-string input', () => {
            expect(ut.isDaemonVersion(5)).to.be.false
        })
        it('isDaemonVersion() returns false on over-long input', () => {
            expect(ut.isDaemonVersion(new Array(42).join('a'))).to.be.false
        })
        it('isDaemonVersion() returns false on too-short input', () => {
            expect(ut.isDaemonVersion('')).to.be.false
            expect(ut.isDaemonVersion('abc')).to.be.false
        })
        it('isDaemonVersion() returns false on bad characters', () => {
            expect(ut.isDaemonVersion('#example-protocol.Version')).to.be.false
        })
    })
})

describe('Networking primitives', () => {
    describe('Port', () => {
        it('isPort() returns false for non-numbers', () => {
            expect(ut.isPort('abc')).to.be.false
        })
        it('isPort() returns false for out-of-range', () => {
            expect(ut.isPort(-1)).to.be.false
            expect(ut.isPort(65536)).to.be.false
        })
        it('isPort() returns true for valid port', () => {
            expect(ut.isPort(15351)).to.be.true
        })
        it('toNumber() returns expected value', () => {
            const myPort: ut.Port = 22 as any as ut.Port
            expect(ut.portToNumber(myPort)).to.equal(22)
        })
    })
    describe('Hostname', () => {
        it('isHostName() -> false for elements not beginning or ending with alphanumeric character', () => {
            expect(ut.isHostName('-.1.1.1')).to.be.false
            expect(ut.isHostName('+')).to.be.false
            expect(ut.isHostName('1.-1.1')).to.be.false
            expect(ut.isHostName('1.1.1-')).to.be.false
            expect(ut.isHostName('.5.6.7')).to.be.false
            expect(ut.isHostName('5.6.7.')).to.be.false
        })
        it('isHostName() returns false for non-string input', () => {
            expect(ut.isHostName(5)).to.be.false
        })
        it('isHostName() -> false when address contains a bad character', () => {
            expect(ut.isHostName('www.amazon+.com')).to.be.false
        })
        it('isHostName() -> true on ip address', () => {
            expect(ut.isHostName('0.0.0.0')).to.be.true
        })
        it('isHostName() -> true on valid DNS-style entry', () => {
            expect(ut.isHostName('www.flatironinstitute.org')).to.be.true
        })
    })
    describe('Address', () => {
        // Note: the "right" way to do this would be to mock isHostname() and isPort()
        // and then just make sure both of them get called.
        const validHost: ut.HostName = 'www.flatironinstitute.org' as any as ut.HostName
        const validPort: ut.Port = 15351 as any as ut.Port
        const invalidHost: ut.HostName = 'www.flat!iron+.com' as any as ut.HostName
        const invalidPort: ut.Port = -5 as any as ut.Port
        it('isAddress() returns true on valid host/port', () => {
            expect(ut.isAddress({ hostName: validHost, port: validPort })).to.be.true
        })
        it('isAddress() returns false on invalid host', () => {
            expect(ut.isAddress({ hostName: invalidHost, port: validPort })).to.be.false
        })
        it('isAddress() returns false on invalid port', () => {
            expect(ut.isPort({ hostName: validHost, port: invalidPort })).to.be.false
        })
    })
})

describe('Time', () => {
    const time1: ut.Timestamp = Number(new Date(2020, 1, 1, 1, 1, 1, 0)) - 0 as any as ut.Timestamp
    describe('Type guard', () => {
        it('isTimestamp() returns true for converted date', () => {
            expect(ut.isTimestamp(time1)).to.be.true
        })
        it('isTimestamp() returns true for non-negative integers', () => {
            expect(ut.isTimestamp(50)).to.be.true
            expect(ut.isTimestamp(0)).to.be.true
        })
        it('isTimestamp() returns false for non-numeric value', () => {
            expect(ut.isTimestamp('five pm')).to.be.false
        })
        it('isTimestamp() returns false for negative integers', () => {
            expect(ut.isTimestamp(-50)).to.be.false
        })
        it('isTimestamp() returns false for non-integer numbers', () => {
            expect(ut.isTimestamp(4.5)).to.be.false
        })
    })
    describe('Manipulation fns', () => {
        it('zeroTimestamp() returns value equal to 0', () => {
            expect(ut.zeroTimestamp()).to.equal(0)
        })
        it('nowTimestamp() matches current dateTime', () => {
            const now = Number(new Date())
            expect((ut.nowTimestamp() as any as number) - now).is.closeTo(0, 2)
        })
        it('elapsedSince() returns correct result', () => {
            const now = ut.nowTimestamp()
            const newTime = ((now as any as number) - 5) as any as ut.Timestamp
            const diff = ut.elapsedSince(newTime)
            expect(diff).to.be.greaterThan(4).and.lessThan(7) // s.b. 5 but might be 6 if we get unlucky
        })
    })
})

describe('Crypto types', () => {
    const keyBody: string = '\nPRIVATEKEYAAADt4+bJGhgtv/oPS3eZrEL8vYBXo0j3D7mNUM=\n'
    const validPubKey: string = `-----BEGIN PUBLIC KEY-----${keyBody}-----END PUBLIC KEY-----`
    const validPrivKey: string = `-----BEGIN PRIVATE KEY-----${keyBody}-----END PRIVATE KEY-----`

    describe('Key pairs', () => {
        it('isPublicKey() returns true for valid public key', () => {
            expect(ut.isPublicKey(validPubKey)).to.be.true
        })
        it('isPublicKey() returns false on non-string input', () => {
            expect(ut.isPublicKey(15)).to.be.false
        })
        it('isPublicKey() returns false when header is missing', () => {
            expect(ut.isPublicKey(keyBody)).to.be.false
        })
        it('isPublicKey() returns false for private key', () => {
            expect(ut.isPublicKey(validPrivKey)).to.be.false
        })
        it('isPrivateKey() returns true for valid private key', () => {
            expect(ut.isPrivateKey(validPrivKey)).to.be.true
        })
        it('isPrivateKey() returns false on non-string input', () => {
            expect(ut.isPrivateKey(15)).to.be.false
        })
        it('isPrivateKey() returns false when header is missing', () => {
            expect(ut.isPrivateKey(keyBody)).to.be.false
        })
        it('isPrivateKey() returns false on valid public key', () => {
            expect(ut.isPrivateKey(validPubKey)).to.be.false
        })
        it('isKeyPair() returns true on valid public and private key', () => {
            expect(ut.isKeyPair({ publicKey: validPubKey, privateKey: validPrivKey })).to.be.true
        })
        it('isKeyPair() returns false on bad public key', () => {
            expect(ut.isKeyPair({ publicKey: '', privateKey: validPrivKey })).to.be.false
        })
        it('isKeyPair() returns false on bad private key', () => {
            expect(ut.isKeyPair({ publicKey: validPubKey, privateKey: '' })).to.be.false
        })
        it('TODO: isKeyPair() returns false when keys do not match', () => {
            expect(true).to.be.true
        })
    })
    describe('Key Hexes', () => {
        const validKeyHex = new Array(5).join('0123456789abcdef') // 4 x 16 = 64
        it('isPublicKeyHex returns true on hex input', () => {
            expect(ut.isPublicKeyHex(validKeyHex)).to.be.true
        })
        it('isPublicKeyHex returns false on non-string input', () => {
            expect(ut.isPublicKeyHex(5)).to.be.false
        })
        it('isPublicKeyHex returns false on non-hex string input', () => {
            expect(ut.isPublicKeyHex('natural string + 5')).to.be.false
        })
        it('isPublicKeyHex returns false on invalid-length input', () => {
            expect(ut.isPublicKeyHex(extendByValidChar(validKeyHex))).to.be.false
            expect(ut.isPublicKeyHex(shorterByOne(validKeyHex))).to.be.false
        })
        it('isPrivateKeyHex returns true on hex input', () => {
            expect(ut.isPrivateKeyHex(validKeyHex)).to.be.true
        })
        it('isPrivateKeyHex returns false on non-string input', () => {
            expect(ut.isPrivateKeyHex(5)).to.be.false
        })
        it('isPrivateKeyHex returns false on non-hex string input', () => {
            expect(ut.isPrivateKeyHex('natural string + 5')).to.be.false
        })
        it('isPrivateKeyHex returns false on invalid-length input', () => {
            expect(ut.isPrivateKeyHex(extendByValidChar(validKeyHex))).to.be.false
            expect(ut.isPrivateKeyHex(shorterByOne(validKeyHex))).to.be.false
        })
    })
    describe('Hashes/Signatures', () => {
        const validHash = '63a0f8f44232cba2eca23dea7baa4e176b93e957'
        it('isSha1Hash() returns true on valid input', () => {
            expect(ut.isSha1Hash(validHash)).to.be.true
        })
        it('isSha1Hash() returns false on non-string input', () => {
            expect(ut.isSha1Hash(5)).to.be.false
        })
        it('isSha1Hash() returns false on wrong-length input', () => {
            expect(ut.isSha1Hash(extendByValidChar(validHash))).to.be.false
            expect(ut.isSha1Hash(shorterByOne(validHash))).to.be.false
        })
        it('isSha1Hash() returns false on non-hexadecimal characters', () => {
            expect(ut.isSha1Hash('012345678901234567890123456789qwrty*%$+#')).to.be.false
        })
        const validSignature: string = new Array(129).join('a')
        it('isSignature() returns true on valid input', () => {
            expect(ut.isSignature(validSignature)).to.be.true
        })
        it('isSignature() returns false on non-hex input', () => {
            expect(ut.isSignature(5)).to.be.false
            expect(ut.isSignature(replaceInitialWithChar(validSignature, ' '))).to.be.false
        })
        it('isSignature() returns false on wrong-length input', () => {
            expect(ut.isSignature(shorterByOne(validSignature))).to.be.false
            expect(ut.isSignature(extendByValidChar(validSignature))).to.be.false
        })
    })
})

describe('Kachery primitives', () => {
    describe('Nodes', () => {
        it('isNodeId() returns true for valid node id', () => {
            expect(ut.isNodeId(validNodeId)).to.be.true
        })
        it('isNodeId() returns false for non-string input', () => {
            expect(ut.isNodeId(5)).to.be.false
        })
        it('isNodeId() returns false for wrong-length input', () => {
            expect(ut.isNodeId(shorterByOne(validNodeId as any as string))).to.be.false
            expect(ut.isNodeId(extendByValidChar(validNodeId as any as string))).to.be.false
        })
        it('isNodeId() returns false for non-hex input', () => {
            // simple character switch for tested-valid string to isolate the character.
            // Note, we should use replaceAll() but it is not supported by our interpreter.
            expect(ut.isNodeId(validNodeId.split('a').join('#'))).to.be.false
        })
    })
    describe('Channels', () => {
        it('isChannelName() returns true for good channel name', () => {
            expect(ut.isChannelName(validChannelName)).to.be.true
        })
        it('isChannelName() returns false for non-string input', () => {
            expect(ut.isChannelName(5)).to.be.false
        })
        it('isChannelName() returns false for wrong-length input', () => {
            expect(ut.isChannelName(new Array(4).join('-'))).to.be.false
            expect(ut.isChannelName(new Array(162).join('-'))).to.be.false
        })
        it('isChannelName() returns false for invalid character input', () => {
            expect(ut.isChannelName(validChannelName + '+ @!#$%')).to.be.false
        })
    })
    describe('Feeds', () => {
        it('isFeedId() returns true for 64-character hex string', () => {
            expect(ut.isFeedId(validFeedId)).to.be.true
        })
        it('isFeedId() returns false for non-string input', () => {
            expect(ut.isFeedId(5)).to.be.false
        })
        // again, ideally a lot of this testing would be deferred to a test of isHex and confirming
        // that a stubbed isHex method actually got called. Oh well.
        it('isFeedId() returns false for wrong-length input', () => {
            expect(ut.isFeedId(shorterByOne(validFeedId as any as string))).to.be.false
            expect(ut.isFeedId(extendByValidChar(validFeedId as any as string))).to.be.false
        })
        it('isFeedId() returns false for non-hexadecimal input', () => {
            expect(ut.isFeedId(validFeedId.split('F').join(' '))).to.be.false
        })
    })
    describe('Subfeeds', () => {
        it('isSubfeedHash() returns true on valid subfeed hash', () => {
            expect(ut.isSubfeedHash(validSubfeedHash)).to.be.true
        })
        it('isSubfeedHash() returns false on non-string input', () => {
            expect(ut.isSubfeedHash(5)).to.be.false
        })
        it('isSubfeedHash() returns false on bad-length input', () => {
            expect(ut.isSubfeedHash(shorterByOne(validSubfeedHash as any as string))).to.be.false
            expect(ut.isSubfeedHash(extendByValidChar(validSubfeedHash as any as string))).to.be.false
        })
        it('isSubfeedHash() returns false on non-hex input', () => {
            expect(ut.isSubfeedHash(replaceInitialWithChar(validSubfeedHash as any as string, '-'))).to.be.false
        })
    })
    describe('ErrorMessage', () => {
        it('isErrorMessage() returns true for valid string', () => {
            expect(ut.isErrorMessage('This is an error message')).to.be.true
        })
        it('isErrorMessage() returns false for non-string input', () => {
            expect(ut.isErrorMessage(5)).to.be.false
        })
        it('isErrorMessage() returns false for too-long string', () => {
            expect(ut.isErrorMessage(new Array(1001).join('-'))).to.be.false    
        })
        it('errorMessage() is identity function', () => {
            const value = 'This is an example error message and should be returned exactly'
            expect(ut.errorMessage(value)).to.equal(value)
        })
        it('errorMessage() returns a valid error message', () => {
            expect(ut.isErrorMessage(ut.errorMessage('This is an error message'))).to.be.true
        })
        it('errorMessage() throws on over-long string', () => {
            let badFn = () => { ut.errorMessage(new Array(1001).join('-')) }
            expect(badFn).to.throw()
        })
    })
    describe('Multicast Announce messages', () => {
        const validAnnounceRequestData: AnnounceRequestData = {
            requestType: 'announce',
            channelNodeInfo: validChannelNodeInfo as any as ut.ChannelNodeInfo
        }
        const validMulticastMessageBody: ut.MulticastAnnounceMessageBody = {
            protocolVersion: 'protocol-version-12' as any as ut.ProtocolVersion,
            fromNodeId: (new Array(65).join('0')) as any as ut.NodeId,
            messageType: 'announce',
            requestData: validAnnounceRequestData,
            udpSocketPort: null,
            timestamp: ut.nowTimestamp()
        }
        it('Confirm validChannelNodeInfo is actually valid', () => {
            expect(ut.isChannelNodeInfo(validChannelNodeInfo)).to.be.true            
        })
        it('isMulticastAnnounceMessageBody() returns true on valid input', () => {
            expect(ut.isMulticastAnnounceMessageBody(validMulticastMessageBody)).to.be.true
        })
        it('isMulticastAnnounceMessageBody() returns false on wrong messageType', () => {
            expect(ut.isMulticastAnnounceMessageBody({
                ...validMulticastMessageBody,
                messageType: 'declaration'
            })).to.be.false
        })
        it('isMulticastAnnounceMessage() returns true on valid input', () => {
            expect(ut.isMulticastAnnounceMessage({ body: validMulticastMessageBody, signature: new Array(129).join('1') })).to.be.true
        })
        it('isMulticastAnnounceMessage() returns false on missing body or signature', () => {
            expect(ut.isMulticastAnnounceMessage({ body: validMulticastMessageBody, signature: null })).to.be.false
            expect(ut.isMulticastAnnounceMessage({ body: undefined, signature: new Array(129).join('2') })).to.be.false
        })
    })
    describe('FileKey', () => {
        it('isFileKey() returns true for valid file key object', () => {
            expect(ut.isFileKey(validFileKey)).to.be.true
        })
    })
    describe('Conversions', () => {
        const value = new Array(65).join('3')
        it('Conversion functions are identity function', () => {
            expect(ut.nodeIdToPublicKey(value as any as ut.NodeId)).to.equal(hexToPublicKey(value as any as ut.PublicKeyHex))
            expect(ut.feedIdToPublicKeyHex(value as any as ut.FeedId)).to.equal(value)
            expect(ut.publicKeyHexToNodeId(value as any as ut.PublicKeyHex)).to.equal(value)
        })
        it('nodeIdToPublicKey() returns valid public key', () => {
            const ret = ut.nodeIdToPublicKey(value as any as ut.NodeId)
            expect(ut.isPublicKey(ret)).to.be.true
        })
        it('feedToPublicKeyHex() returns valid PublicKeyHex', () => {
            const ret = ut.feedIdToPublicKeyHex(value as any as ut.FeedId)
            expect(ut.isPublicKeyHex(ret)).to.be.true
        })
        it('publicKeyHexToNodeId() returnsValid NodeId', () => {
            const ret = ut.publicKeyHexToNodeId(value as any as ut.PublicKeyHex)
            expect(ut.isNodeId(ret)).to.be.true
        })
    })
})

describe('Searches and Requests', () => {
    describe('FindLiveFeedResult', () => {
        it('isFindLiveFeedResult() returns true for object with valid node ID', () => {
            expect(ut.isFindLiveFeedResult({ nodeId: validNodeId, channelName: validChannelName })).to.be.true
        })
    })
    describe('FindFileResult', () => {
        const validResult: ut.FindFileResult = {
            nodeId: validNodeId,
            channelName: validChannelName,
            fileKey: validFileKey,
            fileSize: ut.byteCount(16)
        }
        it('isFindFileResult() returns true for valid input', () => {
            expect(ut.isFindFileResult(validResult)).to.be.true
        })
        it('isFindFileResult() returns false for non-conforming object', () => {
            expect(ut.isFindFileResult({ ...validResult, fileKey: null })).to.be.false
        })
    })
    describe('Request', () => {
        const validRequestId = ut.createRequestId() as any as string
        it('createRequestId produces 10-character alphanumeric string', () => {
            expect(validRequestId.length).to.equal(10)
            expect(/^[a-zA-Z]{10}$/.test(validRequestId)).to.be.true
        })
        it('isRequestId() returns true for valid string', () => {
            expect(ut.isRequestId(validRequestId)).to.be.true
        })
        it('isRequestId() returns false for non-string input', () => {
            expect(ut.isRequestId(10)).to.be.false
        })
        it('isRequestId() returns false for incorrect length', () => {
            expect(ut.isRequestId(validRequestId + 'a')).to.be.false
            expect(ut.isRequestId(validRequestId.substring(1, validRequestId.length))).to.be.false
        })
        it('isRequestId() returns false for non-alphabetic input', () => {
            // change the first character of the valid string to a 0 which is non-alphabetic
            const invalidRequestId = validRequestId.split('').splice(0, 1, '0').join('')
            expect(ut.isRequestId(invalidRequestId)).to.be.false
        })
    })
})

describe('Channels', () => {
    const validChannelName: ut.ChannelName = 'this-is-my-channel' as any as ut.ChannelName
    const validNodeInfo: ut.ChannelNodeInfo = { body: validNodeInfoBody, signature: new Array(129).join('a') as any as ut.Signature }
    describe('ChannelName', () => {
        it('isChannelName() returns true on valid channel name', () => {
            expect(ut.isChannelName(validChannelName)).to.be.true
        })
        it('isChannelName() returns false on non-string input', () => {
            expect(ut.isChannelName(5)).to.be.false
        })
        it('isChannelName() returns false on wrong-length input', () => {
            expect(ut.isChannelName('abc')).to.be.false
            expect(ut.isChannelName(new Array(162).join('_'))).to.be.false
        })
        it('isChannelName() returns false on bad characters', () => {
            expect(ut.isChannelName(validChannelName + '+')).to.be.false
        })
    })
    describe('ChannelNodeInfo', () => {
        it('isChannelNodeInfoBody() returns true for valid test data', () => {
            expect(ut.isChannelNodeInfoBody(validNodeInfoBody)).to.be.true
        })
        it('isChannelNodeInfoBody() returns false for bad data', () => {
            expect(ut.isChannelNodeInfoBody( { ...validNodeInfoBody, nodeId: '' } )).to.be.false
        })
        it('isChannelNodeInfo() returns true for body with any signature', () => {
            expect(ut.isChannelNodeInfo(validNodeInfo)).to.be.true
        })
        it('isChannelNodeInfo() returns false on missing signature', () => {
            expect(ut.isChannelNodeInfo({ ...validNodeInfo, signature: '' })).to.be.false
        })
    })
    describe('ChannelInfo', () => {
        it('isChannelInfo() returns true for array of valid ChannelNodeInfo', () => {
            expect(ut.isChannelInfo({ nodes: [validNodeInfo] })).to.be.true
        })
        it('isChannelInfo() returns false for array containing invalid ChannelNodeInfo', () => {
            expect(ut.isChannelInfo( { nodes: [validNodeInfo, { ...validNodeInfo, signature: '' } ] })).to.be.false
        })
    })
})

describe('Feeds', () => {
    describe('FeedName', () => {
        it('isFeedName() returns true for string', () => {
            expect(ut.isFeedName('This is my feed name')).to.be.true
        })
        it('isFeedName() returns false for empty string', () => {
            expect(ut.isFeedName('')).to.be.false
        })
        it('isFeedName() returns false for non-string input', () => {
            expect(ut.isFeedName(5)).to.be.false
        })
    })
    describe('FeedSubfeedId', () => {
        const feedId = new Array(65).join('6')
        const hash = new Array(41).join('c')
        it('isFeedSubfeedId() returns true for valid sample', () => {
            expect(ut.isFeedSubfeedId(`${feedId}:${hash}`)).to.be.true
        })
        it('isFeedSubfeedId() returns false for non-string input', () => {
            expect(ut.isFeedSubfeedId(-6)).to.be.false
        })
        it('isFeedSubfeedId() returns false for strings with wrong number of parts', () => {
            expect(ut.isFeedSubfeedId(`${feedId}:${hash}:extra`)).to.be.false
            expect(ut.isFeedSubfeedId(`${feedId}${hash}`)).to.be.false
        })
        it('isFeedSubfeedId() returns false for empty feed Id', () => {
            expect(ut.isFeedSubfeedId(`:${hash}`)).to.be.false
        })
        it('isFeedSubfeedId() returns false for invalid subfeed hash', () => {
            expect(ut.isFeedSubfeedId(`${feedId}:badHash`)).to.be.false
        })
        it('feedSubfeedId() returns inputs joined by colon', () => {
            let a = feedId as any as ut.FeedId
            let b = hash as any as ut.SubfeedHash
            let c = ut.feedSubfeedId(a, b)
            expect(c).to.equal(`${a}:${b}`)
        })
    })
})

describe('Subfeed Messages', () => {
    const validSubfeedMessage: ut.SubfeedMessage = { key: 'value' } as any as ut.SubfeedMessage
    const validSubfeedMsgMetaData: ut.SubfeedMessageMetaData = { metakey: 'metavalue' }
    const sig1: ut.SignedSubfeedMessage = new Array(129).join('1') as any as ut.SignedSubfeedMessage
    const sig2: ut.SignedSubfeedMessage = new Array(129).join('2') as any as ut.SignedSubfeedMessage

    describe('SubfeedMessage', () => {
        it('isSubfeedMessage() returns true for object input', () => {
            expect(ut.isSubfeedMessage(validSubfeedMessage)).to.be.true
        })
        it('isSubfeedMessage() returns false for non-Object input', () => {
            expect(ut.isSubfeedMessage(6)).to.be.false
        })
    })
    describe('SubfeedMessageMetaData', () => {
        it('isSubfeedMessageMetaData() returns true for object input', () => {
            expect(ut.isSubfeedMessageMetaData(validSubfeedMsgMetaData)).to.be.true
        })
        it('isSubfeedMessageMetaData() returns false for non-Object input', () => {
            expect(ut.isSubfeedMessageMetaData(6)).to.be.false
        })
    })
    describe('SignedSubfeedMessage', () => {
        const msg: ut.SignedSubfeedMessage = {
            body: {
                previousSignature: sig1 as any as ut.Signature,
                messageNumber: 2,
                message: validSubfeedMessage,
                timestamp: ut.nowTimestamp(),
                metaData: validSubfeedMsgMetaData
            },
            signature: sig2 as any as ut.Signature
        }
        it('isSignedSubfeedMessage() returns true on valid input', () => {
            expect(ut.isSignedSubfeedMessage(msg)).to.be.true
        })
        it('isSignedSubfeedMessage() returns true on input without previous sig', () => {
            const noPriorSig = {
                body: {
                    ...msg.body,
                    previousSignature: undefined
                },
                signature: sig2
            }
            expect(ut.isSignedSubfeedMessage(noPriorSig)).to.be.true
        })
        it('isSignedSubfeedMessage() returns true on input without metadata', () => {
            const noMetadata = {
                body: {
                    ...msg.body,
                    metaData: undefined
                },
                signature: sig2
            }
            expect(ut.isSignedSubfeedMessage(noMetadata)).to.be.true
        })
        it('isSignedSubfeedMessage() returns false if number, message, or timestamp fails validation', () => {
            const noNumber = { body: { ...msg.body, messageNumber: undefined }, signature: sig2 }
            const noMessage = { body: { ...msg.body, message: undefined }, signature: sig2 }
            const noTime = { body: { ...msg.body, timestamp: undefined }, signature: sig2 }
            expect(ut.isSignedSubfeedMessage(noNumber)).to.be.false
            expect(ut.isSignedSubfeedMessage(noMessage)).to.be.false
            expect(ut.isSignedSubfeedMessage(noTime)).to.be.false
        })
    })
    describe('SubmittedSubfeedMessage', () => {
        const myMsg: ut.SubmittedSubfeedMessage = { 'key': new Array(9990).join('!') } as any as ut.SubmittedSubfeedMessage // stringifies to 9999 characters
        it('isSubmittedSubfeedMessage() returns true for valid object', () => {
            expect(ut.isSubmittedSubfeedMessage(myMsg)).to.be.true
        })
        it('isSubmittedSubfeedMessage() returns false for non-object input', () => {
            expect(ut.isSubmittedSubfeedMessage(6)).to.be.false
        })
        it('isSubmittedSubfeedMessage() returns false for over-long input', () => {
            expect(ut.isSubmittedSubfeedMessage( { 'key': new Array(9991).join('!') })).to.be.false
        })
        it('submittedSubfeedMessageToSubfeedMessage() acts as identity function', () => {
            const newMsg = ut.submittedSubfeedMessageToSubfeedMessage(myMsg as any as ut.SubmittedSubfeedMessage)
            expect(newMsg).to.deep.equal(myMsg)
        })
    })
})

describe('Subfeed Access', () => {
    const accessWriteAllowedRule: ut.SubfeedAccessRule = { nodeId: validNodeId, write: true }
    const accessWriteDeniedRule: ut.SubfeedAccessRule = { nodeId: validNodeId, write: false }
    describe('SubfeedAccessRule', () => {
        it('isSubfeedAccessRule() returns true for valid node id and write value', () => {
            expect(ut.isSubfeedAccessRule(accessWriteAllowedRule)).to.be.true
            expect(ut.isSubfeedAccessRule(accessWriteDeniedRule)).to.be.true
        })
        it('isSubfeedAccessRule() returns false for invalid node id', () => {
            expect(ut.isSubfeedAccessRule({ ...accessWriteAllowedRule, nodeId: 'foo' })).to.be.false
        })
        it('isSubfeedAccessRule() returns false for non-boolean write value', () => {
            expect(ut.isSubfeedAccessRule({ ...accessWriteAllowedRule, write: 12 })).to.be.false
        })
    })
    describe('SubfeedAccessRules', () => {
        it('isSubfeedAccessRules() returns true for valid rule list', () => {
            expect(ut.isSubfeedAccessRules({ rules: [accessWriteAllowedRule, accessWriteDeniedRule] })).to.be.true
        })
        it('isSubfeedAccessRules() returns false when list contains an invalid rule', () => {
            expect(ut.isSubfeedAccessRules({
                rules: [ accessWriteAllowedRule, {...accessWriteDeniedRule, write: 12 } ]
            })).to.be.false
        })
    })
})

describe('Subfeed subscriptions', () => {
    const myWatchName: ut.SubfeedWatchName = 'Hortense the Subfeed Watch' as any as ut.SubfeedWatchName
    const mySubfeedWatch: ut.SubfeedWatch = { feedId: validFeedId, subfeedHash: validSubfeedHash, position: ut.subfeedPosition(12) }
    describe('Subfeed Watch Name', () => {
        it('isSubfeedWatchName() returns true for string input', () => {
            expect(ut.isSubfeedWatchName(myWatchName))
        })
        it('isSubfeedWatchName() returns false for non-string input', () => {
            expect(ut.isSubfeedWatchName(12)).to.be.false
        })
        it('isSubfeedWatchName(0 returns false for zero-length string input', () => {
            expect(ut.isSubfeedWatchName('')).to.be.false
        })
    })
    describe('Subfeed Watch (subscription)', () => {
        it('isSubfeedWatch() returns true for valid subfeed watch object', () => {
            expect(ut.isSubfeedWatch(mySubfeedWatch)).to.be.true
        })
        it('isSubfeedWatch() returns false for any invalid field', () => {
            expect(ut.isSubfeedWatch({ ...mySubfeedWatch, feedId: 'not a feed id ++' })).to.be.false
            expect(ut.isSubfeedWatch({ ...mySubfeedWatch, subfeedHash: undefined })).to.be.false
            expect(ut.isSubfeedWatch({ ...mySubfeedWatch, position: 'front' })).to.be.false
        })
    })
    describe('Subfeed Watches (mapping SubfeedName to SubfeedWatch)', () => {
        it('isSubfeedWatches() returns true for valid mapping of name to watch', () => {
            expect(ut.isSubfeedWatches({ [myWatchName.toString()]: mySubfeedWatch })).to.be.true
        })
        it('isSubfeedWatches() returns false for invalid watch', () => {
            expect(ut.isSubfeedWatches({
                [myWatchName.toString()]: mySubfeedWatch,
                'invalid watch': { feedId: 12 }
            })).to.be.false
        })
        it('isSubfeedWatches() returns false for non-object input', () => {
            expect(ut.isSubfeedWatches(12)).to.be.false
        })
    })
    describe('Subfeed Watch object-memory conversions', () => {
        const obj = { [myWatchName.toString()]: mySubfeedWatch }
        const map = new Map<ut.SubfeedWatchName, ut.SubfeedWatch>()
        map.set(myWatchName as any as ut.SubfeedWatchName, mySubfeedWatch as any as ut.SubfeedWatch)
        // probably should've found a way to not repeat this from the objectToMap() stuff 700 lines above
        const areEquivalent = (obj: {[key: string]: any}, map: Map<ut.SubfeedWatchName, ut.SubfeedWatch>): boolean => {
            for (let k in obj) if(obj[k] !== map.get(k as any as ut.SubfeedWatchName)) return false
            for (let k in map.keys()) if (map.get(k as any as ut.SubfeedWatchName) !== obj[k]) return false
            return true
        }
        it('toSubfeedWatches() is identity function', () => {
            const res = ut.toSubfeedWatches(map)
            expect(areEquivalent(res, map)).to.be.true
            expect(res).to.deep.equal(obj)
        })
        it('toSubfeedWatchesRAM() is identity function', () => {
            const res = ut.toSubfeedWatchesRAM(obj)
            expect(areEquivalent(obj, res)).to.be.true
            expect(res).to.deep.equal(map)
        })
    })
})

describe('Live Feed Subscriptions', () => {
    const validLiveFeedSubscription: ut.LiveFeedSubscription = {
        subscriptionName: "This is my subscription name" as any as ut.LiveFeedSubscriptionName,
        feedId: new Array(65).join('F') as any as ut.FeedId,
        subfeedHash: new Array(41).join('b') as any as ut.SubfeedHash,
        position: ut.subfeedPosition(12)
    }
    describe('Live Feed Subscription Name', () => {
        it('isLiveFeedSubscriptionName() returns true for valid name', () => {
            expect(ut.isLiveFeedSubscriptionName('0123456789_abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOPQRSTUVWXYZ .')).to.be.true
        })
        it('isLiveFeedSubscriptionName() returns false for non-string input', () => {
            expect(ut.isLiveFeedSubscriptionName(5)).to.be.false
        })
        it('isLiveFeedSubscriptionName() returns false for bad characters', () => {
            expect(ut.isLiveFeedSubscriptionName('*****')).to.be.false
        })
        it('isLifeFeedSubscriptionName() returns false for bad-length name', () => {
            expect(ut.isLiveFeedSubscriptionName(new Array(162).join('a'))).to.be.false
            expect(ut.isLiveFeedSubscriptionName('abc')).to.be.false
        })
    })
    describe('Live Feed Subscription', () => {
        it('isLiveFeedSubscription() returns true for valid position', () => {
            expect(ut.isLiveFeedSubscription(validLiveFeedSubscription)).to.be.true
        })
        it('isLiveFeedSubscription() returns false for missing position', () => {
            expect(ut.isLiveFeedSubscription({ ...validLiveFeedSubscription, position: undefined })).to.be.false
        })
    })
    describe('Live Feed Subscription sets', () => {
        it('isLiveFeedSubscriptions() returns true for array with valid entries', () => {
            const feeds = { subscriptions: [ validLiveFeedSubscription, { ...validLiveFeedSubscription, position: 2 }]}
            expect(ut.isLiveFeedSubscriptions(feeds)).to.be.true
        })
        it('isLiveFeedSubscriptions() returns false for array with an invalid entry', () => {
            const feeds = { subscriptions: [ validLiveFeedSubscription, { ...validLiveFeedSubscription, position: undefined }]}
            expect(ut.isLiveFeedSubscriptions(feeds)).to.be.false
        })
    })
})