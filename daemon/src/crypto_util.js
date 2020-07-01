import hypersign from '@hyperswarm/hypersign';
import sodium from 'sodium-universal';

const H = new hypersign.Hypersign();

export const getSignature = (obj, keyPair) => {
    const buf = Buffer.from(JSON.stringify(obj), 'utf-8');
    const signature = H.sign(buf, {keypair: keyPair}).toString('hex');
    return signature;
}

export const verifySignature = (obj, signature, publicKey) => {
    return sodium.crypto_sign_verify_detached(
        Buffer.from(signature, 'hex'),
        H.signable(Buffer.from(JSON.stringify(obj), 'utf-8')),
        publicKey
    );
}

export const createKeyPair = () => {
    return H.keypair();
}