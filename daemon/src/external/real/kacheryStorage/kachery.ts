import { exec } from 'child_process';

export const kacheryStoreWithHardLink = async (path: string) => {
    try {
        await executeAndGetStdout(`kachery-p2p-store ${path} --use-hard-links`);
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
    return new Promise<string>((resolve, reject) => {
        exec(command, function(error, stdout, stderr) {
            if (error) {
                reject(error);
                return;
            }
            resolve(stdout);
        });
    });
}

// export const getLocalFileInfo = async ({fileKey}) => {
//     const kacheryUri = kacheryUriFromFileKey(fileKey);
//     return await kacheryInfo(kacheryUri);
// }

// const kacheryUriFromFileKey = (fileKey) => {
//     return `sha1://${fileKey.sha1}`;
// }