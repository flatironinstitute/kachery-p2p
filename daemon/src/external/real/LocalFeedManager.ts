import fs from 'fs';
import { createKeyPair, hexToPrivateKey, JSONStringifyDeterministic, privateKeyToHex, publicKeyHexToFeedId, publicKeyToHex } from '../../common/crypto_util';
import GarbageMap from '../../common/GarbageMap';
import { FeedId, FeedName, isFeedId, isJSONObject, isPrivateKeyHex, isSignedSubfeedMessage, isSubfeedAccessRules, localFilePath, LocalFilePath, PrivateKey, PrivateKeyHex, scaledDurationMsec, SignedSubfeedMessage, SubfeedAccessRules, SubfeedHash, _validateObject } from '../../interfaces/core';

interface FeedConfig {
    feedId: FeedId,
    privateKey: PrivateKeyHex
}
const isFeedConfig = (x: any): x is FeedConfig => {
    return _validateObject(x, {
        feedId: isFeedId,
        privateKey: isPrivateKeyHex
    })
}

class FeedsConfigManager {
    #configDir: LocalFilePath
    #feedsConfigMemCache = new GarbageMap<FeedId, FeedConfig>(scaledDurationMsec(60 * 60 * 1000))
    #feedIdsByNameMemCache = new GarbageMap<FeedName, FeedId>(scaledDurationMsec(60 * 60 * 1000))
    constructor(configDir: LocalFilePath, private opts: {useMemoryCache: boolean}) {
        this.#configDir = configDir
    }

    async addFeed(feedId: FeedId, privateKey: PrivateKeyHex) {
        const c = await this.getFeedConfig(feedId)
        if (c) {
            throw Error('Cannot add feed. Feed with this ID already exists')
        }
        const dirPath = await this._feedConfigDirectory(feedId, {create: true})
        const config: FeedConfig = {
            feedId,
            privateKey
        }
        await writeJsonFile(`${dirPath}/config.json`, config)
        this.#feedsConfigMemCache.set(feedId, {feedId, privateKey})
    }
    async getFeedConfig(feedId: FeedId): Promise<FeedConfig | null> {
        const c = this.#feedsConfigMemCache.get(feedId)
        if ((c) && (this.opts.useMemoryCache)) {
            return c
        }
        const dirPath = await this._feedConfigDirectory(feedId, {create: false})
        if (fs.existsSync(dirPath.toString())) {
            const config = await readJsonFile(`${dirPath}/config.json`, {})
            if (isFeedConfig(config)) {
                this.#feedsConfigMemCache.set(feedId, config)
                return config
            }
        }
        return null
    }
    async deleteFeed(feedId: FeedId) {
        if (this.#feedsConfigMemCache.has(feedId)) {
            this.#feedsConfigMemCache.delete(feedId)
        }
        const dirPath = await this._feedConfigDirectory(feedId, {create: false})
        if (fs.existsSync(dirPath.toString())) {
            await fs.promises.rmdir(dirPath.toString(), {recursive: true})
        }
    }
    async setFeedIdForName(feedName: FeedName, feedId: FeedId) {
        const path = await this._feedIdByNamePath(feedName, {create: true})
        await writeJsonFile(path.toString(), {feedName, feedId})
        this.#feedIdsByNameMemCache.set(feedName, feedId)
    }
    async getFeedIdForName(feedName: FeedName): Promise<FeedId | null> {
        const f = this.#feedIdsByNameMemCache.get(feedName)
        if ((f) && (this.opts.useMemoryCache)) return f
        const path = await this._feedIdByNamePath(feedName, {create: false})
        if (!fs.existsSync(path.toString())) return null
        const a = await readJsonFile(path.toString(), {})
        if (!isJSONObject(a)) return null
        const feedId = a.feedId
        if (!feedId) return null
        if (isFeedId(feedId)) {
            this.#feedIdsByNameMemCache.set(feedName, feedId)
            return feedId
        }
        else return null
    }
    async _feedConfigDirectory(feedId: FeedId, opts: {create: boolean}): Promise<LocalFilePath> {
        const f = feedId
        const ret = `${this.#configDir}/feeds/${f[0]}${f[1]}/${f[2]}${f[3]}/${f[4]}${f[5]}/${f}`
        if (opts.create) {
            if (!fs.existsSync(ret)) {
                await fs.promises.mkdir(ret, {recursive: true})
            }
        }
        return localFilePath(ret)
    }
    async _feedIdByNamePath(feedName: FeedName, opts: {create: boolean}): Promise<LocalFilePath> {
        const f = feedName
        const p = `${this.#configDir}/feeds/byName`
        if (opts.create) {
            if (!fs.existsSync(p)) {
                await fs.promises.mkdir(p, {recursive: true})
            }
        }
        return localFilePath(`${p}/${feedName}.json`)
    }
}

export default class LocalFeedManager {
    #storageDir: LocalFilePath
    #configDir: LocalFilePath
    #feedsConfigManager: FeedsConfigManager
    constructor(storageDir: LocalFilePath, configDir: LocalFilePath) {
        if (!fs.existsSync(storageDir.toString())) {
            throw Error(`Storage directory does not exist: ${storageDir}`)
        }
        this.#storageDir = storageDir
        this.#configDir = configDir
        this.#feedsConfigManager = new FeedsConfigManager(this.#configDir, {useMemoryCache: true}) // todo: need to test this for both false and true
    }
    async createFeed(feedName: FeedName | null): Promise<FeedId> {
        // Create a new writeable feed on this node and return the ID of the new feed

        // Generate the crypto keypair. The publicKey determines the new feed ID
        const {publicKey, privateKey} = createKeyPair();
        const feedId = publicKeyHexToFeedId(publicKeyToHex(publicKey));

        await this.#feedsConfigManager.addFeed(feedId, privateKeyToHex(privateKey))
        if (feedName !== null) {
            await this.#feedsConfigManager.setFeedIdForName(feedName, feedId)
        }

        // Create the feed directory for the actual feed
        await _createFeedDirectoryIfNeeded(this.#storageDir, feedId)

        // Return the feed ID
        return feedId
    }
    async deleteFeed(feedId: FeedId) {
        await this.#feedsConfigManager.deleteFeed(feedId)
    }
    async getFeedId(feedName: FeedName): Promise<FeedId | null> {
        // assert(typeof(feedName) === 'string');
        // Look up the feed ID for a particular feed name by consulting the config file

        return await this.#feedsConfigManager.getFeedIdForName(feedName)
    }
    async hasWriteableFeed(feedId: FeedId) {
        // Check whether this node has a writeable feed.
        // We do this by ensuring that we have the associated private key and that the feed directory exists
        const privateKey = await this.getPrivateKeyForFeed(feedId)
        if (!privateKey) return false
        // Returns true if we have the writeable feed
        return fs.existsSync(_feedDirectory(this.#storageDir, feedId))
    }
    async getPrivateKeyForFeed(feedId: FeedId): Promise<PrivateKey | null> {
        // Consult the config to get the private key associated with a particular feed ID
        const c = await this.#feedsConfigManager.getFeedConfig(feedId)
        return c ? hexToPrivateKey(c.privateKey) : null
    }
    feedExistsLocally(feedId: FeedId): boolean {
        return fs.existsSync(_feedDirectory(this.#storageDir, feedId))
    }
    async getSignedSubfeedMessages(feedId: FeedId, subfeedHash: SubfeedHash): Promise<SignedSubfeedMessage[]> {
        // Read the messages file
        const subfeedMessagesPath = _subfeedDirectory(this.#storageDir, feedId, subfeedHash) + '/messages'
        return await readMessagesFile(subfeedMessagesPath)
    }
    async getSubfeedAccessRules(feedId: FeedId, subfeedHash: SubfeedHash): Promise<SubfeedAccessRules | null> {
        await _createSubfeedDirectoryIfNeeded(this.#storageDir, feedId, subfeedHash);

        const accessRulesPath = _subfeedDirectory(this.#storageDir, feedId, subfeedHash) + '/access'
        const accessRules = await readJsonFile(accessRulesPath, {rules: []})
        if (!isSubfeedAccessRules(accessRules)) {
            throw Error('Invalid access rules.')
        }
        return accessRules
    }
    appendSignedMessagesToSubfeed(feedId: FeedId, subfeedHash: SubfeedHash, messages: SignedSubfeedMessage[]) {
        // important that this is synchronous!
        const textLinesToAppend = messages.map(sm => (JSONStringifyDeterministic(sm)))
        const subfeedDir = _subfeedDirectory(this.#storageDir, feedId, subfeedHash)
        fs.mkdirSync(subfeedDir, {recursive: true})
        const subfeedMessagesPath = subfeedDir + '/messages'
        fs.appendFileSync(subfeedMessagesPath, textLinesToAppend.join('\n') + '\n', {encoding: 'utf8'})
    }
    setSubfeedAccessRules(feedId: FeedId, subfeedHash: SubfeedHash, accessRules: SubfeedAccessRules): void {
        const subfeedDir = _subfeedDirectory(this.#storageDir, feedId, subfeedHash)
        fs.mkdirSync(subfeedDir, {recursive: true})
        const accessRulesPath = subfeedDir + '/access'
        writeJsonFileSync(accessRulesPath, accessRules);
    }
}

const _createSubfeedDirectoryIfNeeded = async (storageDir: LocalFilePath, feedId: FeedId, subfeedHash: SubfeedHash) => {
    const path = _subfeedDirectory(storageDir, feedId, subfeedHash);
    if (!fs.existsSync(path)) {
        await fs.promises.mkdir(path, {recursive: true});
    }
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

const _feedParentDirectory = (storageDir: LocalFilePath, feedId: FeedId): string => {
    return `${storageDir}/feeds/${feedId[0]}${feedId[1]}/${feedId[2]}${feedId[3]}/${feedId[4]}${feedId[5]}`;
}

const _feedDirectory = (storageDir: LocalFilePath, feedId: FeedId): string => {
    return `${_feedParentDirectory(storageDir, feedId)}/${feedId}`;
}

const _subfeedDirectory = (storageDir: LocalFilePath, feedId: FeedId, subfeedHash: SubfeedHash): string => {
    const feedDir = _feedDirectory(storageDir, feedId);
    return `${feedDir}/subfeeds/${subfeedHash[0]}${subfeedHash[1]}/${subfeedHash[2]}${subfeedHash[3]}/${subfeedHash[4]}${subfeedHash[5]}/${subfeedHash}`
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

const writeJsonFile = async (path: string, obj: Object) => {
    const txt = JSONStringifyDeterministic(obj, 4);
    await fs.promises.writeFile(path, txt);
}

const writeJsonFileSync = (path: string, obj: Object) => {
    const txt = JSONStringifyDeterministic(obj, 4);
    fs.writeFileSync(path, txt)
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