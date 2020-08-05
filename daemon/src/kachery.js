import { exec } from 'child_process'
import fs from 'fs';
import { sha1sum } from './common/crypto_util.js';

// const _getTemporaryDirectory = () => {
//     const ret = process.env['KACHERY_STORAGE_DIR'] + '/tmp';
//     mkdirIfNeeded(ret);
//     return ret;
// }

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

export const kacheryStoreWithHardLink = async (path) => {
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

const executeAndGetStdout = async (command) => {
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

// const mkdirIfNeeded = (path) => {
//     if (!fs.existsSync(path)) {
//         try {
//             fs.mkdirSync(path);
//         }
//         catch(err) {
//             if (!fs.existsSync(path)) {
//                 fs.mkdirSync(path);
//             }
//         }
//     }
// }

export const getLocalFileInfo = async ({fileKey}) => {
    if (fileKey.sha1) {
        const s = fileKey.sha1;
        const path = `${kacheryStorageDir()}/sha1/${s[0]}${s[1]}/${s[2]}${s[3]}/${s[4]}${s[5]}/${s}`;
        let stat0;
        try {
            stat0 = await fs.promises.stat(path);
        }
        catch(err) {
            return null;
        }
        return {
            path,
            size: stat0.size,
            sha1: s
        }
    }
    else if ((fileKey.transformedSha1) && (fileKey.transformNodeId) && (fileKey.sha1Head)) {
        const s = fileKey.sha1Head;
        const path = `${kacheryStorageDir()}/sha1/${s[0]}${s[1]}/${s[2]}${s[3]}/${s[4]}${s[5]}`;
        let fileNames;
        try {
            fileNames = await fs.promises.readdir(path);
        }
        catch(err) {
            fileNames = [];
        }
        for (let fileName of fileNames) {
            if ((fileName.startsWith(fileKey.sha1Head)) && (fileName.length === 40)) {
                if (sha1sum(fileKey.transformNodeId + fileName) === fileKey.transformedSha1) {
                    return await getLocalFileInfo({fileKey: {sha1: fileName}});
                }
            }
        }
        return null;
    }
    else {
        throw Error('Problem with fileKey', fileKey);
    }
}

// export const getLocalFileInfo = async ({fileKey}) => {
//     const kacheryUri = kacheryUriFromFileKey(fileKey);
//     return await kacheryInfo(kacheryUri);
// }

// const kacheryUriFromFileKey = (fileKey) => {
//     return `sha1://${fileKey.sha1}`;
// }