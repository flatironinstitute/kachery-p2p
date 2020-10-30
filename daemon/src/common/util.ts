import assert from 'assert';
import bson from 'bson';
import { Address, DurationMsec, durationMsecToNumber, elapsedSince, FileKey, isAddress, nowTimestamp, scaledDurationMsec, Sha1Hash, unscaledDurationMsec } from '../interfaces/core';

export const randomAlphaString = (num_chars: number) => {
    if (!num_chars) {
        /* istanbul ignore next */
        throw Error('randomAlphaString: num_chars needs to be a positive integer.')
    }
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    for (var i = 0; i < num_chars; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}

export const sha1MatchesFileKey = ({ sha1, fileKey }: { sha1: Sha1Hash, fileKey: FileKey }) => {
    if (fileKey.sha1) {
        return fileKey.sha1 === sha1
    }
    return false
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
            /* istanbul ignore next */
            console.warn(ret)
            /* istanbul ignore next */
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


export const sleepMsec = async (msec: DurationMsec, continueFunction: (() => boolean) | undefined = undefined): Promise<void> => {
    return await sleepMsecNum(msec as any as number)
}

export const sleepMsecNum = async (msec: number, continueFunction: (() => boolean) | undefined = undefined): Promise<void> => {
    const m = msec
    if (continueFunction) {
        const timer = nowTimestamp()
        while (m - elapsedSince(timer) > durationMsecToNumber(scaledDurationMsec(1000))) {
            if (!continueFunction()) {
                return
            }
            await sleepMsec(scaledDurationMsec(1000))
        }
        if (m > elapsedSince(timer)) {
            await sleepMsec(unscaledDurationMsec(m - elapsedSince(timer)))
        }
    }
    else return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve()
        }, m)
    })
}

class StringParseError extends Error {
    constructor(errorString: string) {
        super(errorString);
    }
}

export class RequestTimeoutError extends Error {
    constructor(errorString: string) {
        super(errorString);
    }
}

export const parseBootstrapInfo = (x: string): Address => {
    const a = x.split(':')
    assert(a.length === 2, 'Improper bootstrap string')
    const b = {
        hostName: a[0],
        port: Number(a[1])
    };
    if (!isAddress(b)) {
        /* istanbul ignore next */
        throw new StringParseError('Improper bootstrap info.');
    }
    return b
}
