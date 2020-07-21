import crypto from 'crypto';

const ed25519PubKeyPrefix = "302a300506032b6570032100";
const ed25519PrivateKeyPrefix = "302e020100300506032b657004220420";

// safe
export const getSignature = (obj, keyPair) => {
    try {
        return crypto.sign(null, Buffer.from(JSONStringifyDeterministic(obj), 'utf-8'), keyPair.privateKey).toString('hex');
    }
    catch(err) {
        console.warn(err);
        console.warn('Exception when creating signature.');
        return null;
    }
}

export const verifySignature = (obj, signature, publicKey) => {
    try {
        return crypto.verify(null, Buffer.from(JSONStringifyDeterministic(obj), 'utf-8'), publicKey, Buffer.from(signature, 'hex'));
    }
    catch(err) {
        console.warn(err);
        console.warn('Exception when verifying signature.');
        return false;
    }
}

export const sha1sum = (txt) => {
    var shasum = crypto.createHash('sha1')
    shasum.update(txt)
    return shasum.digest('hex')
}

export const publicKeyToHex = (publicKey) => {
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
    return ret.slice(ed25519PubKeyPrefix.length);
}

export const privateKeyToHex = (privateKey) => {
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
    return ret.slice(ed25519PrivateKeyPrefix.length);
}

export const hexToPublicKey = (x) => {
    if (!x) {
        throw Error('Error in hexToPublicKey. Input is empty.');
    }
    return `-----BEGIN PUBLIC KEY-----\n${Buffer.from(ed25519PubKeyPrefix + x, 'hex').toString('base64')}\n-----END PUBLIC KEY-----\n`;
}

export const hexToPrivateKey = (x) => {
    if (!x) {
        throw Error('Error in hexToPrivateKey. Input is empty.');
    }
    return `-----BEGIN PRIVATE KEY-----\n${Buffer.from(ed25519PrivateKeyPrefix + x, 'hex').toString('base64')}\n-----END PRIVATE KEY-----\n`;
}

export const createKeyPair = () => {
    return crypto.generateKeyPairSync('ed25519', {
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
}

// Thanks: https://stackoverflow.com/questions/16167581/sort-object-properties-and-json-stringify
function JSONStringifyDeterministic( obj, space )
{
    var allKeys = [];
    JSON.stringify( obj, function( key, value ){ allKeys.push( key ); return value; } )
    allKeys.sort();
    return JSON.stringify( obj, allKeys, space );
}
