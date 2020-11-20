import fs from 'fs';
import { JSONStringifyDeterministic } from '../../common/crypto_util';
import { FeedId, isSignedSubfeedMessage, isSubfeedAccessRules, LocalFilePath, SignedSubfeedMessage, SubfeedAccessRules, SubfeedHash } from "../../interfaces/core";

class LocalFeedsDatabaseOld {
    constructor(private storageDir: LocalFilePath) {

    }
    async addFeed(feedId: FeedId) {
        // Create the feed directory for the actual feed
        await _createFeedDirectoryIfNeeded(this.storageDir, feedId) ////////////////////////////////
    }
    async deleteFeed(feedId: FeedId) {
        // todo
    }
    async hasFeed(feedId: FeedId): Promise<boolean> {
        return fs.existsSync(_feedDirectory(this.storageDir, feedId))
    }
    async getSignedSubfeedMessages(feedId: FeedId, subfeedHash: SubfeedHash): Promise<SignedSubfeedMessage[]> {
        const subfeedMessagesPath = _subfeedDirectory(this.storageDir, feedId, subfeedHash) + '/messages'
        return await readMessagesFile(subfeedMessagesPath)
    }
    async getSubfeedAccessRules(feedId: FeedId, subfeedHash: SubfeedHash): Promise<SubfeedAccessRules | null> {
        await _createSubfeedDirectoryIfNeeded(this.storageDir, feedId, subfeedHash);

        const accessRulesPath = _subfeedDirectory(this.storageDir, feedId, subfeedHash) + '/access'
        const accessRules = await readJsonFile(accessRulesPath, {rules: []})
        if (!isSubfeedAccessRules(accessRules)) {
            throw Error('Invalid access rules.')
        }
        return accessRules
    }
    async setSubfeedAccessRules(feedId: FeedId, subfeedHash: SubfeedHash, accessRules: SubfeedAccessRules): Promise<void> {
        const subfeedDir = _subfeedDirectory(this.storageDir, feedId, subfeedHash)
        fs.mkdirSync(subfeedDir, {recursive: true})
        const accessRulesPath = subfeedDir + '/access'
        writeJsonFileSync(accessRulesPath, accessRules);
    }
    async appendSignedMessagesToSubfeed(feedId: FeedId, subfeedHash: SubfeedHash, messages: SignedSubfeedMessage[]) {
        const textLinesToAppend = messages.map(sm => (JSONStringifyDeterministic(sm)))
        const subfeedDir = _subfeedDirectory(this.storageDir, feedId, subfeedHash)
        fs.mkdirSync(subfeedDir, {recursive: true})
        const subfeedMessagesPath = subfeedDir + '/messages'
        fs.appendFileSync(subfeedMessagesPath, textLinesToAppend.join('\n') + '\n', {encoding: 'utf8'})
    }
}

const writeJsonFileSync = (path: string, obj: Object) => {
    const txt = JSONStringifyDeterministic(obj, 4);
    fs.writeFileSync(path, txt)
}

const _createFeedDirectoryIfNeeded = async (storageDir: LocalFilePath, feedId: FeedId) => {
    const path = _feedDirectory(storageDir, feedId);
    if (!fs.existsSync(path)) {
        await fs.promises.mkdir(path, {recursive: true});
    }
    if (!fs.existsSync(path + '/subfeeds')) {
        await fs.promises.mkdir(path + '/subfeeds', {recursive: true});
    }
}

const _feedDirectory = (storageDir: LocalFilePath, feedId: FeedId): string => {
    return `${_feedParentDirectory(storageDir, feedId)}/${feedId}`;
}

const _feedParentDirectory = (storageDir: LocalFilePath, feedId: FeedId): string => {
    return `${storageDir}/feeds/${feedId[0]}${feedId[1]}/${feedId[2]}${feedId[3]}/${feedId[4]}${feedId[5]}`;
}

const _subfeedDirectory = (storageDir: LocalFilePath, feedId: FeedId, subfeedHash: SubfeedHash): string => {
    const feedDir = _feedDirectory(storageDir, feedId);
    return `${feedDir}/subfeeds/${subfeedHash[0]}${subfeedHash[1]}/${subfeedHash[2]}${subfeedHash[3]}/${subfeedHash[4]}${subfeedHash[5]}/${subfeedHash}`
}

const readMessagesFile = async (path: string): Promise<SignedSubfeedMessage[]> => {
    let txt: string;
    try {
        txt = await fs.promises.readFile(path, {encoding: 'utf8'});
    }
    catch(err) {
        return [];
    }
    if (typeof(txt) !== 'string') {
        throw Error('Unexpected: txt is not a string.');
    }
    let messages: SignedSubfeedMessage[] = [];
    const lines = txt.split('\n');
    for (let line of lines) {
        if (line) {
            let signedMessage: Object;
            try {
                signedMessage = JSON.parse(line);
            }
            catch(err) {
                console.warn(`Problem parsing JSON from file.`, {path});
                return [];
            }
            if (isSignedSubfeedMessage(signedMessage)) {
                messages.push(signedMessage);
            }
            else {
                console.warn(`Problem with signed message from JSON file.`, {path});
                return [];
            }
            
        }
    }
    return messages;
}

const _createSubfeedDirectoryIfNeeded = async (storageDir: LocalFilePath, feedId: FeedId, subfeedHash: SubfeedHash) => {
    const path = _subfeedDirectory(storageDir, feedId, subfeedHash);
    if (!fs.existsSync(path)) {
        await fs.promises.mkdir(path, {recursive: true});
    }
}

const readJsonFile = async (path: string, defaultVal: Object): Promise<Object> => {
    try {
        const txt = await fs.promises.readFile(path, 'utf-8') as string;
        return JSON.parse(txt);
    }
    catch(err) {
        return defaultVal;
    }
}

export default LocalFeedsDatabaseOld