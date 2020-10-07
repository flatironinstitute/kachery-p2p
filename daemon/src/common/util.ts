import bson from 'bson';
import fs from 'fs';
import { FileKey, Sha1Hash } from '../interfaces/core';

export const randomString = (num_chars: number) => {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (var i = 0; i < num_chars; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}

export const randomAlphaString = (num_chars: number) => {
    if (!num_chars) {
        throw Error('randomAlphaString: num_chars needs to be a positive integer.')
    }
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    for (var i = 0; i < num_chars; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}

export const randomHexString = (num_chars: number) => {
    if (!num_chars) {
        throw Error('randomHexString: num_chars needs to be a positive integer.')
    }
    var text = "";
    var possible = "0123456789abcdef";
    for (var i = 0; i < num_chars; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}

export const sha1MatchesFileKey = ({sha1, fileKey}: {sha1: Sha1Hash, fileKey: FileKey}) => {
    if (fileKey.sha1) {
        return fileKey.sha1 === sha1
    }
    return false
}

export const readJsonFile = async (path: string) => {
    const txt = await fs.promises.readFile(path, 'utf-8');
    return JSON.parse(txt);
}

export const kacheryP2PSerialize = (x: Object) => {
    return bson.serialize(sortKeysInObject(x));
}

export const kacheryP2PDeserialize = (x: Buffer) => {
    return convertBinaryToBufferInObject(bson.deserialize(x));
}

const sortKeysInObject = (x: any): any => {
    if (x instanceof Buffer) {
        return x;
    }
    else if (x instanceof Object) {
        if (Array.isArray(x)) {
            return x.map(a => (sortKeysInObject(a)));
        }
        else {
            const keys = Object.keys(x).sort();
            let ret: any = {};
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

const convertBinaryToBufferInObject = (x: any): any => {
    if (x instanceof bson.Binary) {
        // This might be the troublesome line.
        // We should check to see if the underlying type is byte array before returning the internal buffer.
        const ret = x.buffer
        if (ret instanceof Buffer) {
            return ret
        }
        else {
            console.warn(ret)
            throw Error(`Problem in convertBinaryToBufferInObject`)
        }
    }
    else if (x instanceof Object) {
        if (Array.isArray(x)) {
            return x.map(a => (convertBinaryToBufferInObject(a)));
        }
        else {
            const ret: any = {};
            for (let k in x) {
                ret[k] = convertBinaryToBufferInObject(x[k])
            }
            return ret;
        }
    }
    else {
        return x;
    }
}


export const sleepMsec = (m: number) => new Promise(r => setTimeout(r, m));