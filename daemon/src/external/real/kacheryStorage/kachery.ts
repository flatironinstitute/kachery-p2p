import { exec } from 'child_process';
import fs from 'fs';
import { ByteCount, byteCount, Sha1Hash } from '../../../interfaces/core';

export const kacheryStorageDir = () => {
    const ret = process.env['KACHERY_STORAGE_DIR'];
    if (!ret) {
        throw Error('You must set the KACHERY_STORAGE_DIR environment variable.');
    }
    if (!fs.existsSync(ret)) {
        throw Error(`Kachery storage directory does not exist: ${ret}`);
    }
    return ret;
}

export const kacheryStoreWithHardLink = async (path: string) => {
    try {
        await executeAndGetStdout(`kachery-store ${path} --use-hard-links`);
    }
    catch(err) {
        return false;
    }
    return true;
}

// export const kacheryLoadFile = async (kacheryUri) => {
//     let json;
//     try {
//         json = await executeAndGetStdout(`kachery-info ${kacheryUri}`);
//     }
//     catch(err) {
//         return null;
//     }
//     let obj;
//     try {
//         obj = JSON.parse(json);
//     }
//     catch(err) {
//         return null;
//     }
//     const readFile = util.promisify(fs.readFile);
//     return await readFile(obj.path);
// }

// export const kacheryInfo = async (kacheryUri) => {
//     let json;
//     try {
//         json = await executeAndGetStdout(`kachery-info ${kacheryUri}`);
//     }
//     catch(err) {
//         return null;
//     }
//     let obj;
//     try {
//         obj = JSON.parse(json);
//     }
//     catch(err) {
//         return null;
//     }
//     return obj;
// }

const executeAndGetStdout = async (command: string) => {
    return new Promise((resolve, reject) => {
        exec(command, function(error, stdout, stderr) {
            if (error) {
                reject(error);
                return;
            }
            resolve(stdout);
        });
    });
}

export const getLocalFileInfo = async (fileSha1: Sha1Hash): Promise<{path: string | null, size: ByteCount | null}> => {
    const s = fileSha1;
    const path = `${kacheryStorageDir()}/sha1/${s[0]}${s[1]}/${s[2]}${s[3]}/${s[4]}${s[5]}/${s}`;
    let stat0: fs.Stats
    try {
        stat0 = await fs.promises.stat(path);
    }
    catch(err) {
        return {path: null, size: null};
    }
    return {
        path,
        size: byteCount(stat0.size)
    }
}

// export const getLocalFileInfo = async ({fileKey}) => {
//     const kacheryUri = kacheryUriFromFileKey(fileKey);
//     return await kacheryInfo(kacheryUri);
// }

// const kacheryUriFromFileKey = (fileKey) => {
//     return `sha1://${fileKey.sha1}`;
// }