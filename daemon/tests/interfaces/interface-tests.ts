import { expect } from 'chai' // test library
import * as mocha from 'mocha' // import types for mocha e.g. describe
import { hexToPublicKey } from '../../src/common/crypto_util'
import * as ut from '../../src/interfaces/core'
import { byteCount, ByteCount } from '../../src/udp/UdpCongestionManager'

// Utility string manipulation
const shorterByOne = (x: string): string => { return x.substring(1, x.length) }
const extendByValidChar = (x: string): string => { return x + x.substring(0, 1) }
const replaceInitialWithChar = (x: string, char: string): string => { return char + x.substring(1, x.length) }

// Example objects (test fixtures)
const validChannelName: ut.ChannelName = 'example.Channel-Name' as any as ut.ChannelName
const validNodeId: ut.NodeId = new Array(65).join('a') as any as ut.NodeId
const validFeedId: ut.FeedId = new Array(65).join('F') as any as ut.FeedId
const validSubfeedHash: ut.SubfeedHash = new Array(41).join('b') as any as ut.SubfeedHash
const validFileKey = {
    sha1: new Array(41).join('5'),
    chunkOf: {
        fileKey: { sha1: new Array(41).join('6') },
        startByte: 0 as any as ByteCount,
        endByte: 100 as any as ByteCount
    }
}
// yeah, exporting this is not a great idea... TODO
export const validNodeInfoBody = {
    channelName: 'valid-channel-name',
    nodeId: validNodeId,
    httpAddress: { hostName: 'www.flatironinstitute.org', port: 80 },
    webSocketAddress: { hostName: '192.168.1.1', port: 212 },
    publicUdpSocketAddress: { hostName: '1.1.1.1', port: 443 },
    proxyHttpAddresses: [
        { hostName: '2.2.2.2', port: 80 },
        { hostName: '8.8.8.8', port: 80 }, 
        { hostName: 'www.science.gov', port: 80 }],
    timestamp: ut.nowTimestamp()
}
const validChannelNodeInfo = {
    body: validNodeInfoBody,
    signature: new Array(129).join('3')
}

 // need to explicitly use mocha prefix once or the dependency gets wrongly cleaned up
mocha.describe('Basic typeguards', () => {
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
            expect(ut.isJSONSerializable( { outerkey: { key: new Date() }} )).to.be.false
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
            expect(ut.isNumber(BigInt(5))).to.be.false
        })
        it('isBigInt() returns true on bigint input', () => {
            expect(ut.isBigInt(BigInt(5))).to.be.true
        })
        it('isBigInt() returns false on non-bigint input', () => {
            expect(ut.isBigInt(5)).to.be.false
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
        const objectSpec: ut.ValidateObjectSpec = { mystring: ut.isString }
        const optionalSpecChecker = ut.optional(objectSpec)
        it('optional() spec checker returns true when passed undefined', () => {
            expect(optionalSpecChecker(undefined)).to.be.true
        })
        it('optional() spec checker returns false when passed null', () => {
            expect(optionalSpecChecker(null)).to.be.false
        })
        it('optional() spec checker returns true when object matches spec', () => {
            expect(optionalSpecChecker({ mystring: 'foo' })).to.be.true
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
    describe('Object type checking', () => {
        const hexKeyBigintValueChecker = ut.isObjectOf((x) => /^[0-9a-fA-F]*$/.test(x), ut.isBigInt)
        it('isObjectOf() fn returns true on correct key and value types', () => {
            expect(hexKeyBigintValueChecker({ '0123456789abcdefABCDEF': BigInt(5) })).to.be.true
        })
        it('isObjectOf() fn returns false on wrong-typed key', () => {
            expect(hexKeyBigintValueChecker({ 'non-hex characters': BigInt(5) })).to.be.false
        })
        it('isObjectOf() fn returns false on wrong-typed value', () => {
            expect(hexKeyBigintValueChecker({ '0987': 5 })).to.be.false
        })
        it('isObjectOf() fn returns false on non-object input', () => {
            expect(hexKeyBigintValueChecker('string')).to.be.false
        })
    })
    describe('Object validation to spec', () => {
        const objectSpec: ut.ValidateObjectSpec = { myobj: { mystring: ut.isString }, mynum: ut.isNumber }
        const matchingObject = { myobj: { mystring: 'string' }, mynum: 5 }
        let cb_msg = ''
        const cb = (x: string) => { cb_msg = x }
        it('_validateObject() returns true on correctly formatted object', () => {
            expect(ut._validateObject(matchingObject, objectSpec)).to.be.true
        })
        it('_validateObject() returns false on null input', () => {
            expect(ut._validateObject(null, { x: ut.isBigInt }))
        })
        it('_validateObject() calls callback on null input', () => {
            ut._validateObject(null, { x: ut.isBigInt }, cb)
            expect(cb_msg).to.equal('x is undefined/null.')
        })
        it('_validateObject() returns false on non-object input', () => {
            expect(ut._validateObject('foo', { x: ut.isBigInt }))
        })
        it('_validateObject() calls callback on non-object input', () => {
            ut._validateObject('foo', { x: ut.isBigInt }, cb)
            expect(cb_msg).to.equal('x is not an Object.')
        })
        it('_validateObject() returns false on extra key', () => {
            expect(ut._validateObject({ ...matchingObject, newkey: 'bar' }, objectSpec)).to.be.false
        })
        it('_validateObject() calls callback on extra key', () => {
            ut._validateObject({ ...matchingObject, newkey: 'bar' }, objectSpec, cb)
            expect(cb_msg).to.equal('Key not in spec: newkey')
        })
        it('_validateObject() returns false on wrong-typed value', () => {
            expect(ut._validateObject({ ...matchingObject, mynum: 'five' }, objectSpec)).to.be.false
        })
        it('_validateObject() calls callback on wrong-typed value', () => {
            ut._validateObject({ ...matchingObject, mynum: 'five' }, objectSpec, cb)
            expect(cb_msg).to.equal('Problem validating: mynum')
        })
        it('_validateObject() returns false on missing key', () => {
            const objectMissingKey = { mynum: 5 }
            expect(ut._validateObject(objectMissingKey, objectSpec)).to.be.false
        })
        it('_validateObject() calls callback on missing key', () => {
            const objectMissingKey = { mynum: 5 }
            ut._validateObject(objectMissingKey, objectSpec, cb)
            expect(cb_msg).to.equal('Key not in x: myobj')
        })
        it('_validateObject() returns false on sub-spec validation failure', () => {
            const subobjectHasBadType = { myobj: { mystring: 5 }, mynum: 5}
            expect(ut._validateObject(subobjectHasBadType, objectSpec)).to.be.false
        })
        it('_validateObject() calls callback on sub-spec validation failure', () => {
            const subobjectHasBadType = { myobj: { mystring: 5 }, mynum: 5}
            ut._validateObject(subobjectHasBadType, objectSpec, cb)
            expect(cb_msg).to.equal('Value of key > myobj < itself failed validation.')
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
        const obj3 = { wrongkey: 'value' }
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
            const myport: ut.Port = 22 as any as ut.Port
            expect(ut.toNumber(myport)).to.equal(22)
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
        it('nowTimestamp() matches current datetime', () => {
            const now = Number(new Date())
            expect((ut.nowTimestamp() as any as number) - now).to.equal(0)
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
        const validAnnounceRequestData = { requestType: 'announce', channelNodeInfo: validChannelNodeInfo }
        const validMulticastMessageBody = {
            protocolVersion: 'protocol-version-12',
            fromNodeId: new Array(65).join('0'),
            messageType: 'announce',
            requestData: validAnnounceRequestData
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
        it('publicKeyHexToNodeId() returnsvalid NodeId', () => {
            const ret = ut.publicKeyHexToNodeId(value as any as ut.PublicKeyHex)
            expect(ut.isNodeId(ret)).to.be.true
        })
    })
})

describe('Searches and Requests', () => {
    describe('FindLiveFeedResult', () => {
        // todo: better as confirming call to a stubbed validateObject
        it('isFindLiveFeedResult() returns true for object with valid node ID', () => {
            expect(ut.isFindLiveFeedResult({ nodeId: validNodeId })).to.be.true
        })
    })
    describe('FindFileResult', () => {
        const validResult = {
            nodeId: validNodeId,
            fileKey: validFileKey,
            fileSize: byteCount(16)
        }
        it('isFindFileResult() returns true for valid input', () => {
            expect(ut.isFindFileResult(validResult)).to.be.true
        })
        it('isFindFileResult() returns false for non-conforming object', () => {
            expect(ut.isFindFileResult({ ...validResult, fileKey: null })).to.be.false
        })
        it('isFindFileResult() returns false for negative file size', () => {
            expect(ut.isFindFileResult({ ...validResult, fileSize: BigInt(-50) })).to.be.false
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
    const validChannelName = 'this-is-my-channel'
    const validNodeInfo = { body: validNodeInfoBody, signature: new Array(129).join('a') }
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
            expect(ut.isFeedSubfeedId(`${feedId}:badhash`)).to.be.false
        })
        it('feedSubfeedId() returns inputs joined by colon', () => {
            let a = feedId as any as ut.FeedId
            let b = hash as any as ut.SubfeedHash
            let c = ut.feedSubfeedId(a, b)
            expect(c).to.equal(`${a}:${b}`)
        })
    })
})

describe('Feeds Configuration', () => {
    const myPair = {
        publicKey: new Array(65).join('a'),
        privateKey: new Array(65).join('b')
    }
    // FeedsConfig: { feeds: { [string]: FeedsConfigFeed }, feedIdsByName: { [string]: FeedId }}
    // where FeedId is 64-char hex and FeedName is any nonempty string
    const feedId1 = new Array(65).join('1')
    const feedId2 = new Array(65).join('2')
    const validFeedsConfig = {
        feeds: {
            [feedId1]: myPair,
            [feedId2]: { ...myPair, privateKey: undefined }
        },
        feedIdsByName: {
            one: new Array(65).join('7'),
            b: new Array(65).join('b')
        }
    }
    describe('FeedsConfigFeed', () => {
        it('isFeedsConfigFeed() returns true for pair of valid hexes', () => {
            expect(ut.isFeedsConfigFeed(myPair)).to.be.true
        })
        it('isFeedsConfigFeed() returns true for public key hex only', () => {
            expect(ut.isFeedsConfigFeed({ publicKey: new Array(65).join('2') })).to.be.true
        })
        it('isFeedsConfigFeed() returns false for invalid public key hex', () => {
            expect(ut.isFeedsConfigFeed({ ...myPair, publicKey: 'foo' })).to.be.false
        })
        it('isFeedsConfigFeed() returns false for invalid private key hex', () => {
            expect(ut.isFeedsConfigFeed({ ...myPair, privateKey: 'foo' })).to.be.false
        })
    })
    describe('FeedsConfig', () => {
        it('isFeedsConfig() returns true on valid feeds configuration', () => {
            expect(ut.isFeedsConfig(validFeedsConfig)).to.be.true
        })
        it('isFeedsConfig() returns false on non-FeedId keys', () => {
            expect(ut.isFeedsConfig({
                ...validFeedsConfig,
                feeds: {
                    a: myPair
                }
            })).to.be.false
        })
    })
    describe('Conversions', () => {
        const ram = { feeds: new Map<ut.FeedId, ut.FeedsConfigFeed>(), feedIdsByName: new Map<ut.FeedName, ut.FeedId>() }
        ram.feeds.set(feedId1 as any as ut.FeedId, myPair as any as ut.FeedsConfigFeed)
        ram.feeds.set(feedId2 as any as ut.FeedId, { ...myPair, privateKey: undefined } as any as ut.FeedsConfigFeed)
        ram.feedIdsByName.set('one' as any as ut.FeedName, new Array(65).join('7') as any as ut.FeedId)
        ram.feedIdsByName.set('b' as any as ut.FeedName, new Array(65).join('b') as any as ut.FeedId)
        const match = (obj: { feeds: {[key: string]: any }, feedIdsByName: {[key: string]: any} },
                       maps: { feeds: Map<ut.FeedId, ut.FeedsConfigFeed>, feedIdsByName: Map<ut.FeedName, ut.FeedId> }): boolean =>
                        {
                            const oFeeds = obj.feeds
                            const oByName = obj.feedIdsByName
                            const mFeeds = maps.feeds
                            const mByName = maps.feedIdsByName
                            for (let k in oFeeds) if (oFeeds[k] !== mFeeds.get(k as any as ut.FeedId)) return false
                            for (let k in oByName) if (oByName[k] !== mByName.get(k as any as ut.FeedName)) return false
                            for (let k in mFeeds.keys()) if (mFeeds.get(k as any as ut.FeedId) !== oFeeds[k]) return false
                            for (let k in mByName.keys()) if (mByName.get(k as any as ut.FeedName) !== oByName[k]) return false
                            return true
                        }
        it('toFeedsConfig() is identity function', () => {
            const res = ut.toFeedsConfig(ram)
            expect(match(res, ram)).to.be.true
            expect(res).to.deep.equal(validFeedsConfig)
        })
        it('toFeedsConfigRAM() is identity function', () => {
            const res = ut.toFeedsConfigRAM(validFeedsConfig as any as ut.FeedsConfig)
            expect(match(validFeedsConfig, res)).to.be.true
            expect(res).to.deep.equal(ram)
        })
    })
})

describe('Subfeed Messages', () => {
    const validSubfeedMessage = { key: 'value' }
    const validSubfeedMsgMetaData = { metakey: 'metavalue' }
    const sig1 = new Array(129).join('1')
    const sig2 = new Array(129).join('2')

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
        const msg = {
            body: {
                previousSignature: sig1,
                messageNumber: 2,
                message: validSubfeedMessage,
                timestamp: ut.nowTimestamp(),
                metaData: validSubfeedMsgMetaData
            },
            signature: sig2
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
        const mymsg = { 'key': new Array(9990).join('!') } // stringifies to 9999 characters
        it('isSubmittedSubfeedMessage() returns true for valid object', () => {
            expect(ut.isSubmittedSubfeedMessage(mymsg)).to.be.true
        })
        it('isSubmittedSubfeedMessage() returns false for non-object input', () => {
            expect(ut.isSubmittedSubfeedMessage(6)).to.be.false
        })
        it('isSubmittedSubfeedMessage() returns false for over-long input', () => {
            expect(ut.isSubmittedSubfeedMessage( { 'key': new Array(9991).join('!') })).to.be.false
        })
        it('submittedSubfeedMessageToSubfeedMessage() acts as identity function', () => {
            const newmsg = ut.submittedSubfeedMessageToSubfeedMessage(mymsg as any as ut.SubmittedSubfeedMessage)
            expect(newmsg).to.deep.equal(mymsg)
        })
    })
})

describe('Subfeed Access', () => {
    const accessWriteAllowedRule = { nodeId: validNodeId, write: true }
    const accessWriteDeniedRule = { nodeId: validNodeId, write: false }
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
    const myWatchName = 'Hortense the Subfeed Watch'
    const mySubfeedWatch = { feedId: validFeedId, subfeedHash: validSubfeedHash, position: 12 }
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
            expect(ut.isSubfeedWatches({ [myWatchName]: mySubfeedWatch })).to.be.true
        })
        it('isSubfeedWatches() returns false for invalid watch', () => {
            expect(ut.isSubfeedWatches({
                [myWatchName]: mySubfeedWatch,
                'invalid watch': { feedId: 12 }
            })).to.be.false
        })
        it('isSubfeedWatches() returns false for non-object input', () => {
            expect(ut.isSubfeedWatches(12)).to.be.false
        })
    })
    describe('Subfeed Watch object-memory conversions', () => {
        const obj = { [myWatchName]: mySubfeedWatch }
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
    const validLiveFeedSubscription = {
        subscriptionName: "This is my subscription name",
        feedId: new Array(65).join('F'),
        subfeedHash: new Array(41).join('b'),
        position: 12
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