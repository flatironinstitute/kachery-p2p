import fs from 'fs';

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

export const sleepMsec = m => new Promise(r => setTimeout(r, m));