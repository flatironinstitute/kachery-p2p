import crypto from 'crypto';
import { elapsedSince, FeedId, JSONObject, KeyPair, PrivateKey, PrivateKeyHex, PublicKey, PublicKeyHex, Sha1Hash, Signature, Timestamp } from '../interfaces/core';
import { kacheryP2PSerialize } from './util';

const ed25519PubKeyPrefix = "302a300506032b6570032100";
const ed25519PrivateKeyPrefix = "302e020100300506032b657004220420";

export const getSignature = (obj: Object, keyPair: KeyPair): Signature => {
    try {
        return crypto.sign(null, kacheryP2PSerialize(obj), keyPair.privateKey.toString()).toString('hex') as any as Signature;
    }
    catch(err) {
        console.warn(obj);
        console.warn(err);
        throw Error('Exception when creating signature.');
    }
}

export const getSignatureJson = (obj: Object, keyPair: KeyPair): Signature => {
    try {
        return crypto.sign(null, Buffer.from(JSONStringifyDeterministic(obj)), keyPair.privateKey.toString()).toString('hex') as any as Signature;
    }
    catch(err) {
        console.warn(obj);
        console.warn(err);
        throw Error('Exception when creating signature Json.');
    }
}

export const verifySignatureJson = (obj: JSONObject & {timestamp?: Timestamp}, signature: Signature, publicKey: PublicKey, opts: {checkTimestamp: boolean}={checkTimestamp: false}) => {
    if (opts.checkTimestamp) {
        if (!obj.timestamp) {
            return false;
        }
        const elapsed = elapsedSince(obj.timestamp)
        // needs to be less than 30 minutes old
        const numMinutes = 30;
        if (elapsed > numMinutes * 60 * 1000) {
            return false;
        }
    }
    try {
        return crypto.verify(null, Buffer.from(JSONStringifyDeterministic(obj)), publicKey.toString(), Buffer.from(signature.toString(), 'hex'));
    }
    catch(err) {
        console.warn(err);
        console.warn('Exception when verifying signature.');
        return false;
    }
}

export const verifySignature = (obj: Object & {timestamp?: Timestamp}, signature: Signature, publicKey: PublicKey, opts={checkTimestamp: false}): boolean => {
    if (opts.checkTimestamp) {
        if (!obj.timestamp) {
            return false;
        }
        const elapsed = elapsedSince(obj.timestamp)
        // needs to be less than 30 minutes old
        const numMinutes = 30;
        if (elapsed > numMinutes * 60 * 1000) {
            return false;
        }
    }
    try {
        return crypto.verify(null, kacheryP2PSerialize(obj), publicKey.toString(), Buffer.from(signature.toString(), 'hex'));
    }
    catch(err) {
        console.warn(err);
        console.warn('Exception when verifying signature.');
        return false;
    }
}

export const sha1sum = (txt: string): Sha1Hash => {
    var shasum = crypto.createHash('sha1')
    shasum.update(txt)
    return shasum.digest('hex') as any as Sha1Hash;
}

export const publicKeyToHex = (publicKey: PublicKey): PublicKeyHex => {
    const x = publicKey.split('\n');
    if (x[0] !== '-----BEGIN PUBLIC KEY-----') {
        throw Error('Problem in public key format.');
    }
    if (x[2] !== '-----END PUBLIC KEY-----') {
        throw Error('Problem in public key format.');
    }
    const ret = Buffer.from(x[1], 'base64').toString('hex');
    if (!ret.startsWith(ed25519PubKeyPrefix)) {
        throw Error('Problem in public key format.');
    }
    return ret.slice(ed25519PubKeyPrefix.length) as any as PublicKeyHex;
}

export const publicKeyHexToFeedId = (publicKeyHex: PublicKeyHex): FeedId => {
    return publicKeyToHex as any as FeedId;
}

export const privateKeyToHex = (privateKey: PrivateKey): PrivateKeyHex => {
    const x = privateKey.split('\n');
    if (x[0] !== '-----BEGIN PRIVATE KEY-----') {
        throw Error('Problem in private key format.');
    }
    if (x[2] !== '-----END PRIVATE KEY-----') {
        throw Error('Problem in private key format.');
    }
    const ret = Buffer.from(x[1], 'base64').toString('hex');
    if (!ret.startsWith(ed25519PrivateKeyPrefix)) {
        throw Error('Problem in private key format.');
    }
    return ret.slice(ed25519PrivateKeyPrefix.length) as any as PrivateKeyHex;
}

export const hexToPublicKey = (x: PublicKeyHex): PublicKey => {
    if (!x) {
        throw Error('Error in hexToPublicKey. Input is empty.');
    }
    return `-----BEGIN PUBLIC KEY-----\n${Buffer.from(ed25519PubKeyPrefix + x, 'hex').toString('base64')}\n-----END PUBLIC KEY-----\n` as any as PublicKey;
}

export const hexToPrivateKey = (x: PrivateKeyHex): PrivateKey => {
    if (!x) {
        throw Error('Error in hexToPrivateKey. Input is empty.');
    }
    return `-----BEGIN PRIVATE KEY-----\n${Buffer.from(ed25519PrivateKeyPrefix + x, 'hex').toString('base64')}\n-----END PRIVATE KEY-----\n` as any as PrivateKey;
}

export const createKeyPair = () => {
    const {publicKey, privateKey} = crypto.generateKeyPairSync('ed25519', {
        // modulusLength: 1024,
        publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
        },
        privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem'
            // cipher: 'aes-256-cbc',
            // passphrase: 'top secret'
        }
    });
    return {
        publicKey: publicKey as any as PublicKey,
        privateKey: privateKey as any as PrivateKey
    }
}

// Thanks: https://stackoverflow.com/questions/16167581/sort-object-properties-and-json-stringify
export const JSONStringifyDeterministic = ( obj: Object, space: string | number | undefined =undefined ) => {
    var allKeys: string[] = [];
    JSON.stringify( obj, function( key, value ){ allKeys.push( key ); return value; } )
    allKeys.sort();
    return JSON.stringify( obj, allKeys, space );
}
