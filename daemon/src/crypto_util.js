import crypto from 'crypto';

// safe
export const getSignature = (obj, keyPair) => {
    try {
        return crypto.sign(null, Buffer.from(JSON.stringify(obj), 'utf-8'), keyPair.privateKey).toString('hex');
    }
    catch(err) {
        console.warn(err);
        console.warn('Exception when creating signature.');
        return null;
    }
}

export const verifySignature = (obj, signature, publicKey) => {
    try {
        return crypto.verify(null, Buffer.from(JSON.stringify(obj), 'utf-8'), publicKey, Buffer.from(signature, 'hex'));
    }
    catch(err) {
        console.warn(err);
        console.warn('Exception when verifying signature.');
        return false;
    }
}

export const publicKeyToHex = (publicKey) => {
    const x = publicKey.split('\n')[1];
    return Buffer.from(x, 'base64').toString('hex');
}

export const hexToPublicKey = (x) => {
    return `-----BEGIN PUBLIC KEY-----\n${Buffer.from(x, 'hex').toString('base64')}\n-----END PUBLIC KEY-----`;
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