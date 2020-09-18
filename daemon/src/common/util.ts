import fs from 'fs';
import bson from 'bson';
import { sha1sum } from './crypto_util';

export const randomString = (num_chars) => {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (var i = 0; i < num_chars; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}

export const randomAlphaString = (num_chars) => {
    if (!num_chars) {
        throw Error('randomAlphaString: num_chars needs to be a positive integer.')
    }
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    for (var i = 0; i < num_chars; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}

export const sha1MatchesFileKey = ({sha1, fileKey}) => {
    if (fileKey.sha1) {
        return fileKey.sha1 === sha1;
    }
    else if (fileKey.transformedSha1) {
        if (sha1.startsWith(fileKey.sha1Head)) {
            if (sha1sum(fileKey.transformNodeId + sha1) === fileKey.transformedSha1) {
                return true;
            }
        }
    }
    return false;
}

export const readJsonFile = async (path) => {
    const txt = await fs.promises.readFile(path, 'utf-8');
    return JSON.parse(txt);
}

export const kacheryP2PSerialize = (x) => {
    return bson.serialize(sortKeysInObject(x));
}

export const kacheryP2PDeserialize = (x) => {
    return convertBinaryToBufferInObject(bson.deserialize(x));
}

const sortKeysInObject = (x) => {
    if (x instanceof Buffer) {
        return x;
    }
    else if (x instanceof Object) {
        if (Array.isArray(x)) {
            return x.map(a => (sortKeysInObject(a)));
        }
        else {
            const keys = Object.keys(x).sort();
            let ret = {};
            for (let k of keys) {
                ret[k] = sortKeysInObject(x[k]);
            }
            return ret;
        }
    }
    else {
        return x;
    }
}

const convertBinaryToBufferInObject = (x) => {
    if (x instanceof bson.Binary) {
        // This might be the troublesome line.
        // We should check to see if the underlying type is byte array before returning the internal buffer.
        return x.buffer;
    }
    else if (x instanceof Object) {
        if (Array.isArray(x)) {
            return x.map(a => (convertBinaryToBufferInObject(a)));
        }
        else {
            const ret = {};
            for (let k in x) {
                ret[k] = convertBinaryToBufferInObject(x[k]);
            }
            return ret;
        }
    }
    else {
        return x;
    }
}


export const sleepMsec = m => new Promise(r => setTimeout(r, m));