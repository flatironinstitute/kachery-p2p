import { expect } from 'chai'; // test library
import * as mocha from 'mocha'; // import types for mocha e.g. describe
import * as ut from '../../src/interfaces/core';
import { byteCount } from '../../src/udp/UdpCongestionManager';


// Example objects (test fixtures)
const validChannelName: ut.ChannelName = 'example.Channel-Name' as any as ut.ChannelName;
const validNodeId: ut.NodeId = new Array(65).join('a') as any as ut.NodeId;
const validFeedId: ut.FeedId = new Array(65).join('F') as any as ut.FeedId;
const validSubfeedHash: ut.SubfeedHash = new Array(41).join('b') as any as ut.SubfeedHash;
const validFileKey = {
    sha1: new Array(41).join('5'),
    chunkOf: {
        fileKey: { sha1: new Array(41).join('6') },
        startByte: byteCount(0),
        endByte: byteCount(100)
    }
}

 // need to explicitly use mocha prefix once or the dependency gets wrongly cleaned up
mocha.describe('Basic typeguards', () => {
    describe('JSON Handling', () => {
        // Test fixture for JSON object handling
        const exampleJSONObject = {example: ['json', {object: 1}, '---']}

        it('JSON object successfully recognized', () => {
            expect(ut.isJSONObject(exampleJSONObject)).to.be.true;
        });
        it('isJSONObject() returns false for non-object input', () => {
            expect(ut.isJSONObject('string')).to.be.false;
        });
        it('JSON object recognized as serializable', () => {
            expect(ut.isJSONSerializable(exampleJSONObject)).to.be.true;
        });
        it('isJSONSerializable() returns false on non-object input', () => {
            expect(ut.isJSONSerializable("string input")).to.be.false;
        });
        it('isJSONSerializable() returns false on non-plain input', () => {
            expect(ut.isJSONSerializable(new Map())).to.be.false;
        });
        it('isJSONSerializable() returns false on non-plain property', () => {
            expect(ut.isJSONSerializable( { map: new Map() } )).to.be.false;
        });
        it('JSON object parsed successfully', () => {
            const obj = ut.tryParseJsonObject(JSON.stringify(exampleJSONObject));
            expect(obj).to.deep.equal(exampleJSONObject);
        });
        it('TryParse returns null without throwing on parse failure', () => {
            expect(ut.tryParseJsonObject('This is not json')).to.be.null;
        });
    });
    describe('Object handling', () => {
        it('isObject() returns true on valid object input', () => {
            expect(ut.isObject({name: 'Object', type: 'Object', value: 5})).to.be.true;
        });
        it('isObject() returns false on non-object input', () => {
            expect(ut.isObject('I am a string')).to.be.false;
        })
    });
    describe('String handling', () => {
        it('isString() returns true on string input', () => {
            expect(ut.isString("5")).to.be.true;
        });
        it('isString() returns false on non-string input', () => {
            expect(ut.isString(5)).to.be.false;
        });
    })
    describe('Function handling', () => {
        it('isFunction() returns true on function input', () => {
            expect(ut.isFunction(() => 5)).to.be.true;
        });
        it('isFunction() returns false on non-function input', () => {
            expect(ut.isFunction(5)).to.be.false;
        });
    });
    describe('Number handling', () => {
        it('isNumber() returns true on number input', () => {
            expect(ut.isNumber(5.432)).to.be.true;
            expect(ut.isNumber(-783)).to.be.true;
        });
        it('isNumber() returns false on non-numeric input', () => {
            expect(ut.isNumber('5')).to.be.false;
            expect(ut.isNumber(BigInt(5))).to.be.false;
        });
        it('isBigInt() returns true on bigint input', () => {
            expect(ut.isBigInt(BigInt(5))).to.be.true;
        })
        it('isBigInt() returns false on non-bigint input', () => {
            expect(ut.isBigInt(5)).to.be.false;
        })
    });
    describe('Null handling', () => {
        it('isNull() returns true on null input', () => {
            expect(ut.isNull(null)).to.be.true;
        });
        it('isNull() returns false on non-null input', () => {
            expect(ut.isNull(5)).to.be.false;
        });
    });
    describe('Boolean handling', () => {
        it('isBoolean() returns true on boolean input', () => {
            expect(ut.isBoolean(true)).to.be.true;
            expect(ut.isBoolean(false)).to.be.true;
            expect(ut.isBoolean(5 === 5)).to.be.true;
            expect(ut.isBoolean('a' === 'a')).to.be.true;
        });
        it('isBoolean() returns false on non-boolean input', () => {
            expect(ut.isBoolean('false')).to.be.false;
        });
    })
})

describe('Utility comparisons', () => {
    describe('Hexadecimal-checking method', () => {
        it('isHexadecimal() returns true for hex string', () => {
            expect(ut.isHexadecimal('0123456789abcdefABCDEF')).to.be.true;
        });
        it('isHexadecimal() returns true for hex string of correct length', () => {
            expect(ut.isHexadecimal('12345abcde', 10)).to.be.true;
        });
        it('isHexadecimal() returns false for non-hex characters', () => {
            expect(ut.isHexadecimal('*%+$qwrtyzxv')).to.be.false;
        });
        it('isHexadecimal() returns false for bad length', () => {
            expect(ut.isHexadecimal('12345', 10)).to.be.false;
            expect(ut.isHexadecimal('1234567890', 5)).to.be.false;
        });
    });
    const checker = ut.isOneOf([ut.isBoolean, ut.isString]);
    describe('Type union', () => {
        it('isOneOf() recognizes all enumerated types', () => {
            expect(checker('I am a string')).to.be.true;
            expect(checker(false)).to.be.true;
        });
        it('isOneOf() returns false on non-included types', () => {
            expect(checker(5)).to.be.false;
        });
    });
    describe('Optional: function arguments', () => {
        const optionalStringChecker = ut.optional(ut.isString);
        it('optional() checker returns true when passed undefined', () => {
            expect(optionalStringChecker(undefined)).to.be.true;
        });
        it('optional() checker returns true when passed a matching value', () => {
            expect(optionalStringChecker('string')).to.be.true;
        });
        it('optional() checker returns false when passed null', () => {
            expect(optionalStringChecker(null)).to.be.false;
        });
        it('optional() checker returns false when passed wrong type', () => {
            expect(optionalStringChecker(5)).to.be.false;
        });
    });
    describe('Optional: ValidateObjectSpec arguments', () => {
        const objectSpec: ut.ValidateObjectSpec = { mystring: ut.isString }
        const optionalSpecChecker = ut.optional(objectSpec);
        it('optional() spec checker returns true when passed undefined', () => {
            expect(optionalSpecChecker(undefined)).to.be.true;
        });
        it('optional() spec checker returns false when passed null', () => {
            expect(optionalSpecChecker(null)).to.be.false;
        });
        // here is where you would want to mock _validateObject()
        it('optional() spec checker returns true when object matches spec', () => {
            expect(optionalSpecChecker({ mystring: 'foo' })).to.be.true;
        });
        it('optional() spec checker returns false when object does not match spec', () => {
            expect(optionalSpecChecker({ notMyString: 'foo' })).to.be.false;
        });
    });
    describe('Equality check', () => {
        const isMyString = ut.isEqualTo('myString');
        it('isEqualTo() returns true on equality', () => {
            expect(isMyString('myString')).to.be.true;
        });
        it('isEqualTo() returns false on non-equality', () => {
            expect(isMyString('not my string')).to.be.false;
        });
    });
    describe('Array check', () => {
        const areStrings = ut.isArrayOf(ut.isString);
        it('isArrayOf() returns true on array of specified type', () => {
            expect(areStrings(['These', 'are', 'four', 'strings'])).to.be.true;
        });
        it('isArrayOf() returns false on non-array', () => {
            expect(areStrings('This is not an array')).to.be.false;
        });
        it('isArrayOf() returns false on wrongly-typed members', () => {
            expect(areStrings(['These', 'are', 'not', 5, 'strings'])).to.be.false;
        });
    });
    describe('Object type checking', () => {
        const hexKeyBigintValueChecker = ut.isObjectOf((x) => /^[0-9a-fA-F]*$/.test(x), ut.isBigInt)
        it('isObjectOf() fn returns true on correct key and value types', () => {
            expect(hexKeyBigintValueChecker({ '0123456789abcdefABCDEF': BigInt(5) })).to.be.true;
        });
        it('isObjectOf() fn returns false on wrong-typed key', () => {
            expect(hexKeyBigintValueChecker({ 'non-hex characters': BigInt(5) })).to.be.false;
        });
        it('isObjectOf() fn returns false on wrong-typed value', () => {
            expect(hexKeyBigintValueChecker({ '0987': 5 })).to.be.false;
        });
        it('isObjectOf() fn returns false on non-object input', () => {
            expect(hexKeyBigintValueChecker('string')).to.be.false;
        });
    });
    describe('Object validation to spec', () => {
        const objectSpec: ut.ValidateObjectSpec = { myobj: { mystring: ut.isString }, mynum: ut.isNumber };
        const matchingObject = { myobj: { mystring: 'string' }, mynum: 5 };
        it('_validateObject() returns false on non-object input', () => {
            expect(ut._validateObject('foo', { x: ut.isBigInt }));
        });
        it('_validateObject() returns false on null input', () => {
            expect(ut._validateObject(null, { x: ut.isBigInt }));
        });
        it('_validateObject() returns false on extra key', () => {
            expect(ut._validateObject({ ...matchingObject, newkey: 'bar' }, objectSpec)).to.be.false;
        });
        it('_validateObject() returns false on wrong-typed value', () => {
            expect(ut._validateObject({ ...matchingObject, mynum: 'five' }, objectSpec)).to.be.false;
        });
        it('_validateObject() returns false on missing key', () => {
            const objectMissingKey = { mynum: 5 };
            expect(ut._validateObject(objectMissingKey, objectSpec)).to.be.false;
        });
        it('_validateObject() returns false on sub-spec validation failure', () => {
            const subobjectHasBadType = { myobj: { mystring: 5 }, mynum: 5}
            expect(ut._validateObject(subobjectHasBadType, objectSpec)).to.be.false;
        });
        it('_validateObject() returns true on correctly formatted object', () => {
            expect(ut._validateObject(matchingObject, objectSpec)).to.be.true;
        });
    });
})

describe('Versioning types', () => {
    describe('Protocol Version', () => {
        it('isProtocolVersion() returns true on valid input', () => {
            expect(ut.isProtocolVersion('example-protocol.Version')).to.be.true;
        });
        it('isProtocolVersion() returns false on non-string input', () => {
            expect(ut.isProtocolVersion(5)).to.be.false;
        });
        it('isProtocolVersion() returns false on over-long input', () => {
            // join inserts between each element -- array needs to be 2 bigger than allowed value
            expect(ut.isProtocolVersion(new Array(32).join('a'))).to.be.false;
        });
        it('isProtocolVersion() returns false on too-short input', () => {
            expect(ut.isProtocolVersion('')).to.be.false;
            expect(ut.isProtocolVersion('abc')).to.be.false;
        });
        it('isProtocolVersion() returns false on bad characters', () => {
            expect(ut.isProtocolVersion('#example-protocol.Version')).to.be.false;
        });
    });
    describe('Daemon Version', () => {
        it('isDaemonVersion() returns true on valid input', () => {
            expect(ut.isDaemonVersion('example-daemon.Version')).to.be.true;
        });
        it('isDaemonVersion() returns false on non-string input', () => {
            expect(ut.isDaemonVersion(5)).to.be.false;
        });
        it('isDaemonVersion() returns false on over-long input', () => {
            expect(ut.isDaemonVersion(new Array(42).join('a'))).to.be.false;
        });
        it('isDaemonVersion() returns false on too-short input', () => {
            expect(ut.isDaemonVersion('')).to.be.false;
            expect(ut.isDaemonVersion('abc')).to.be.false;
        });
        it('isDaemonVersion() returns false on bad characters', () => {
            expect(ut.isDaemonVersion('#example-protocol.Version')).to.be.false;
        });
    });
});

describe('Networking primitives', () => {
    describe('Port', () => {
        it('isPort() returns false for non-numbers', () => {
            expect(ut.isPort('abc')).to.be.false;
        });
        it('isPort() returns false for out-of-range', () => {
            expect(ut.isPort(-1)).to.be.false;
            expect(ut.isPort(65536)).to.be.false;
        });
        it('isPort() returns true for valid port', () => {
            expect(ut.isPort(15351)).to.be.true;
        });
        it('toNumber() returns expected value', () => {
            const myport: ut.Port = 22 as any as ut.Port;
            expect(ut.toNumber(myport)).to.equal(22);
        });
    });
    describe('Hostname', () => {
        it('isHostName() -> false for elements not beginning or ending with alphanumeric character', () => {
            expect(ut.isHostName('-.1.1.1')).to.be.false;
            expect(ut.isHostName('+')).to.be.false;
            expect(ut.isHostName('1.-1.1')).to.be.false;
            expect(ut.isHostName('1.1.1-')).to.be.false;
            expect(ut.isHostName('.5.6.7')).to.be.false;
            expect(ut.isHostName('5.6.7.')).to.be.false;
        });
        it('isHostName() returns false for non-string input', () => {
            expect(ut.isHostName(5)).to.be.false;
        });
        it('isHostName() -> false when address contains a bad character', () => {
            expect(ut.isHostName('www.amazon+.com')).to.be.false;
        });
        it('isHostName() -> true on ip address', () => {
            expect(ut.isHostName('0.0.0.0')).to.be.true;
        });
        it('isHostName() -> true on valid DNS-style entry', () => {
            expect(ut.isHostName('www.flatironinstitute.org')).to.be.true;
        });
    });
    describe('Address', () => {
        // Note: the "right" way to do this would be to mock isHostname() and isPort()
        // and then just make sure both of them get called.
        const validHost: ut.HostName = 'www.flatironinstitute.org' as any as ut.HostName;
        const validPort: ut.Port = 15351 as any as ut.Port;
        const invalidHost: ut.HostName = 'www.flat!iron+.com' as any as ut.HostName;
        const invalidPort: ut.Port = -5 as any as ut.Port;
        it('isAddress() returns true on valid host/port', () => {
            expect(ut.isAddress({ hostName: validHost, port: validPort })).to.be.true;
        });
        it('isAddress() returns false on invalid host', () => {
            expect(ut.isAddress({ hostName: invalidHost, port: validPort })).to.be.false;
        });
        it('isAddress() returns false on invalid port', () => {
            expect(ut.isPort({ hostName: validHost, port: invalidPort })).to.be.false;
        });
    });
});

describe('Time', () => {
    const time1: ut.Timestamp = Number(new Date(2020, 1, 1, 1, 1, 1, 0)) - 0 as any as ut.Timestamp;
    describe('Type guard', () => {
        it('isTimestamp() returns true for converted date', () => {
            expect(ut.isTimestamp(time1)).to.be.true;
        });
        it('isTimestamp() returns true for non-negative integers', () => {
            expect(ut.isTimestamp(50)).to.be.true
            expect(ut.isTimestamp(0)).to.be.true;
        });
        it('isTimestamp() returns false for non-numeric value', () => {
            expect(ut.isTimestamp('five pm')).to.be.false;
        });
        it('isTimestamp() returns false for negative integers', () => {
            expect(ut.isTimestamp(-50)).to.be.false;
        });
        it('isTimestamp() returns false for non-integer numbers', () => {
            expect(ut.isTimestamp(4.5)).to.be.false;
        });
    });
    describe('Manipulation fns', () => {
        it('zeroTimestamp() returns value equal to 0', () => {
            expect(ut.zeroTimestamp()).to.equal(0);
        });
        it('nowTimestamp() matches current datetime', () => {
            const now = Number(new Date());
            expect((ut.nowTimestamp() as any as number) - now).to.equal(0);
        });
        it('elapsedSince() returns correct result', () => {
            const now = ut.nowTimestamp();
            const newTime = ((now as any as number) - 5) as any as ut.Timestamp;
            const diff = ut.elapsedSince(newTime);
            expect(diff).to.be.greaterThan(4).and.lessThan(7); // s.b. 5 but might be 6 if we get unlucky
        });
    });
});

describe('Crypto types', () => {
    const keyBody: string = '\nPRIVATEKEYAAADt4+bJGhgtv/oPS3eZrEL8vYBXo0j3D7mNUM=\n';
    const validPubKey: string = `-----BEGIN PUBLIC KEY-----${keyBody}-----END PUBLIC KEY-----`;
    const validPrivKey: string = `-----BEGIN PRIVATE KEY-----${keyBody}-----END PRIVATE KEY-----`;

    describe('Key pairs', () => {
        it('isPublicKey() returns true for valid public key', () => {
            expect(ut.isPublicKey(validPubKey)).to.be.true;
        });
        it('isPublicKey() returns false on non-string input', () => {
            expect(ut.isPublicKey(15)).to.be.false;
        });
        it('isPublicKey() returns false when header is missing', () => {
            expect(ut.isPublicKey(keyBody)).to.be.false;
        });
        it('isPublicKey() returns false for private key', () => {
            expect(ut.isPublicKey(validPrivKey)).to.be.false;
        });
        it('isPrivateKey() returns true for valid private key', () => {
            expect(ut.isPrivateKey(validPrivKey)).to.be.true;
        });
        it('isPrivateKey() returns false on non-string input', () => {
            expect(ut.isPrivateKey(15)).to.be.false;
        });
        it('isPrivateKey() returns false when header is missing', () => {
            expect(ut.isPrivateKey(keyBody)).to.be.false;
        });
        it('isPrivateKey() returns false on valid public key', () => {
            expect(ut.isPrivateKey(validPubKey)).to.be.false;
        });
        it('isKeyPair() returns true on valid public and private key', () => {
            expect(ut.isKeyPair({ publicKey: validPubKey, privateKey: validPrivKey })).to.be.true;
        });
        it('isKeyPair() returns false on bad public key', () => {
            expect(ut.isKeyPair({ publicKey: '', privateKey: validPrivKey })).to.be.false;
        });
        it('isKeyPair() returns false on bad private key', () => {
            expect(ut.isKeyPair({ publicKey: validPubKey, privateKey: '' })).to.be.false;
        });
        it('TODO: isKeyPair() returns false when keys do not match', () => {
            expect(true).to.be.true;
        });
    });
    describe('Key Hexes', () => {
        it('isPublicKeyHex returns true on hex input', () => {
            expect(ut.isPublicKeyHex('0123456789abcdefABCDEF')).to.be.true;
        });
        it('isPublicKeyHex returns false on non-string input', () => {
            expect(ut.isPublicKeyHex(5)).to.be.false;
        });
        it('isPublicKeyHex returns false on non-hex string input', () => {
            expect(ut.isPublicKeyHex('natural string + 5')).to.be.false;
        });
        it('isPrivateKeyHex returns true on hex input', () => {
            expect(ut.isPrivateKeyHex('0123456789abcdefABCDEF')).to.be.true;
        });
        it('isPrivateKeyHex returns false on non-string input', () => {
            expect(ut.isPrivateKeyHex(5)).to.be.false;
        });
        it('isPrivateKeyHex returns false on non-hex string input', () => {
            expect(ut.isPrivateKeyHex('natural string + 5')).to.be.false;
        });
    });
    describe('Hashes/Signatures', () => {
        it('isSha1Hash() returns true on valid input', () => {
            expect(ut.isSha1Hash('63a0f8f44232cba2eca23dea7baa4e176b93e957')).to.be.true;
            expect(ut.isSha1Hash(new Array(41).join('e'))).to.be.true;
        });
        it('isSha1Hash() returns false on non-string input', () => {
            expect(ut.isSha1Hash(5)).to.be.false;
        });
        it('isSha1Hash() returns false on wrong-length input', () => {
            expect(ut.isSha1Hash(new Array(40).join('a'))).to.be.false;
            expect(ut.isSha1Hash(new Array(42).join('4'))).to.be.false;
        });
        it('isSha1Hash() returns false on non-hexadecimal characters', () => {
            expect(ut.isSha1Hash('012345678901234567890123456789qwrty*%$+#')).to.be.false;
        });
        const validSignature: string = new Array(65).join('a');
        it('isSignature() returns true on valid input', () => {
            expect(ut.isSignature(validSignature)).to.be.true;
        });
        it('isSignature() returns false on non-hex input', () => {
            expect(ut.isSignature(5)).to.be.false;
            expect(ut.isSignature(new Array(65).join(' '))).to.be.false;
        });
        it('isSignature() returns false on wrong-length input', () => {
            expect(ut.isSignature(new Array(64).join('a'))).to.be.false;
            expect(ut.isSignature(new Array(66).join('a'))).to.be.false;
        });
    });
});

describe('Kachery primitives', () => {
    describe('Nodes', () => {
        it('isNodeId() returns true for valid node id', () => {
            expect(ut.isNodeId(validNodeId)).to.be.true;
        });
        it('isNodeId() returns false for non-string input', () => {
            expect(ut.isNodeId(5)).to.be.false;
        });
        it('isNodeId() returns false for wrong-length input', () => {
            expect(ut.isNodeId(validNodeId.substring(1, validNodeId.length))).to.be.false;
            expect(ut.isNodeId(validNodeId + 'a')).to.be.false;
        });
        it('isNodeId() returns false for non-hex input', () => {
            // simple character switch for tested-valid string to isolate the character.
            // Note, we should use replaceAll() but it is not supported by our interpreter.
            expect(ut.isNodeId(validNodeId.split('a').join('#'))).to.be.false;
        });
    });
    describe('Channels', () => {
        it('isChannelName() returns true for good channel name', () => {
            expect(ut.isChannelName(validChannelName)).to.be.true;
        });
        it('isChannelName() returns false for non-string input', () => {
            expect(ut.isChannelName(5)).to.be.false;
        });
        it('isChannelName() returns false for wrong-length input', () => {
            expect(ut.isChannelName(new Array(4).join('-'))).to.be.false;
            expect(ut.isChannelName(new Array(162).join('-'))).to.be.false;
        });
        it('isChannelName() returns false for invalid character input', () => {
            expect(ut.isChannelName(validChannelName + '+ @!#$%')).to.be.false;
        });
    });
    describe('Feeds', () => {
        it('isFeedId() returns true for 64-character hex string', () => {
            expect(ut.isFeedId(validFeedId)).to.be.true;
        });
        it('isFeedId() returns false for non-string input', () => {
            expect(ut.isFeedId(5)).to.be.false;
        });
        // again, ideally a lot of this testing would be deferred to a test of isHex and confirming
        // that a stubbed isHex method actually got called. Oh well.
        it('isFeedId() returns false for wrong-length input', () => {
            expect(ut.isFeedId(validFeedId.substring(0, validFeedId.length - 1))).to.be.false;
            expect(ut.isFeedId(validFeedId + 'a')).to.be.false;
        });
        it('isFeedId() returns false for non-hexadecimal input', () => {
            expect(ut.isFeedId(validFeedId.split('F').join(' '))).to.be.false;
        });
    });
    describe('Subfeeds', () => {
        it('isSubfeedHash() returns true on valid subfeed hash', () => {
            expect(ut.isSubfeedHash(validSubfeedHash)).to.be.true;
        });
        it('isSubfeedHash() returns false on non-string input', () => {
            expect(ut.isSubfeedHash(5)).to.be.false;
        });
        it('isSubfeedHash() returns false on bad-length input', () => {
            expect(ut.isSubfeedHash(validSubfeedHash.substring(0, validSubfeedHash.length - 1))).to.be.false;
            expect(ut.isSubfeedHash(validSubfeedHash + 'a')).to.be.false;
        });
        it('isSubfeedHash() returns false on non-hex input', () => {
            expect(ut.isSubfeedHash(validSubfeedHash.split('b').join('-'))).to.be.false;
        });
    });
    describe('FileKey', () => {
        it('isFileKey() returns true for valid file key object', () => {
            expect(ut.isFileKey(validFileKey)).to.be.true;
        });
    });
    describe('Conversions', () => {
        it('TODO: determine if anything exists here to check.', () => {
            
        });
    });
});

describe('Searches and Requests', () => {
    describe('FindLiveFeedResult', () => {
        // todo: better as confirming call to a stubbed validateObject
        it('isFindLiveFeedResult() returns true for object with valid node ID', () => {
            expect(ut.isFindLiveFeedResult({ nodeId: validNodeId })).to.be.true;
        });
    });
    describe('FindFileResult', () => {
        const validResult = {
            nodeId: validNodeId,
            fileKey: validFileKey,
            fileSize: BigInt(100)
        }
        it('isFindFileResult() returns true for valid input', () => {
            expect(ut.isFindFileResult(validResult)).to.be.true;
        });
        it('isFindFileResult() returns false for non-conforming object', () => {
            expect(ut.isFindFileResult({ ...validResult, fileKey: null })).to.be.false;
        });
        it('isFindFileResult() returns false for negative file size', () => {
            expect(ut.isFindFileResult({ ...validResult, fileSize: BigInt(-50) })).to.be.false;
        });
    });
    describe('Request', () => {
        const validRequestId = ut.createRequestId() as any as string;
        it('createRequestId produces 10-character alphanumeric string', () => {
            expect(validRequestId.length).to.equal(10);
            expect(/^[a-zA-Z]{10}$/.test(validRequestId)).to.be.true;
        });
        it('isRequestId() returns true for valid string', () => {
            expect(ut.isRequestId(validRequestId)).to.be.true;
        });
        it('isRequestId() returns false for non-string input', () => {
            expect(ut.isRequestId(10)).to.be.false;
        });
        it('isRequestId() returns false for incorrect length', () => {
            expect(ut.isRequestId(validRequestId + 'a')).to.be.false;
            expect(ut.isRequestId(validRequestId.substring(1, validRequestId.length))).to.be.false;
        });
        it('isRequestId() returns false for non-alphabetic input', () => {
            // change the first character of the valid string to a 0 which is non-alphabetic
            const invalidRequestId = validRequestId.split('').splice(0, 1, '0').join('');
            expect(ut.isRequestId(invalidRequestId)).to.be.false;
        });
    });
});

// describe('FeedsConfig', () => {
//     it('TODO: Determine what needs to be tested here', () => {
        
//     });
// });

//new Array(1001).join('#')