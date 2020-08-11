#!/usr/bin/env node

import bson from 'bson';

const main = () => {
    const x = Buffer.alloc(10000);
    for (let i = 0; i<x.length; i++) {
        x[i] = i;
    }
    console.log(typeof(x));
    console.log(x);
    const a = bson.serialize({data1: x, data2: x});
    console.log(a, a.length);
    const b = convertBinaryToBuffer(bson.deserialize(a));
    console.log(typeof(b.data1));
    console.log(b);
    console.log(bson.Binary.SUBTYPE_BYTE_ARRAY);
}

const convertBinaryToBuffer = (x) => {
    if (x instanceof bson.Binary) {
        return x.buffer;
    }
    else if (x instanceof Object) {
        if (Array.isArray(x)) {
            return x.map(a => (convertBinaryToBuffer(a)));
        }
        else {
            const ret = {};
            for (let k in x) {
                ret[k] = convertBinaryToBuffer(x[k]);
            }
            return ret;
        }
    }
    else {
        return x;
    }
}

main();