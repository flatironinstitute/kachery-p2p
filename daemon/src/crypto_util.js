import crypto from 'crypto';

export const getSignature = (obj, keyPair) => {
    return crypto.sign(null, Buffer.from(JSON.stringify(obj), 'utf-8'), keyPair.privateKey).toString('hex');
}

export const verifySignature = (obj, signature, publicKey) => {
    return crypto.verify(null, Buffer.from(JSON.stringify(obj), 'utf-8'), publicKey, Buffer.from(signature, 'hex'));
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