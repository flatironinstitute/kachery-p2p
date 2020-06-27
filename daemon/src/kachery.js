import { exec } from 'child_process'

// const _getTemporaryDirectory = () => {
//     const ret = process.env['KACHERY_STORAGE_DIR'] + '/tmp';
//     mkdirIfNeeded(ret);
//     return ret;
// }

export const kacheryStoreWithHardLink = async (path) => {
    try {
        await executeAndGetStdout(`kachery-store ${path} --use-hard-links`);
    }
    catch(err) {
        return false;
    }
    return true;
}

export const kacheryLoadFile = async (kacheryPath) => {
    let json;
    try {
        json = await executeAndGetStdout(`kachery-info ${kacheryPath}`);
    }
    catch(err) {
        return null;
    }
    let obj;
    try {
        obj = JSON.parse(json);
    }
    catch(err) {
        return null;
    }
    const readFile = util.promisify(fs.readFile);
    return await readFile(obj.path);
}

export const kacheryInfo = async (kacheryPath) => {
    let json;
    try {
        json = await executeAndGetStdout(`kachery-info ${kacheryPath}`);
    }
    catch(err) {
        return null;
    }
    let obj;
    try {
        obj = JSON.parse(json);
    }
    catch(err) {
        return null;
    }
    return obj;
}

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

function mkdirIfNeeded(path) {
    if (!fs.existsSync(path)) {
        try {
            fs.mkdirSync(path);
        }
        catch(err) {
            if (!fs.existsSync(path)) {
                fs.mkdirSync(path);
            }
        }
    }
}
