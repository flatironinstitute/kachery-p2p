import fs from 'fs';
import os from 'os';
import { createKeyPair, hexToPrivateKey, JSONStringifyDeterministic, privateKeyToHex, publicKeyHexToFeedId, publicKeyToHex } from '../../common/crypto_util';
import { FeedId, FeedName, FeedsConfigRAM, isFeedsConfig, isSignedSubfeedMessage, isSubfeedAccessRules, LocalFilePath, PrivateKey, SignedSubfeedMessage, SubfeedAccessRules, SubfeedHash, toFeedsConfig, toFeedsConfigRAM } from '../../interfaces/core';

export default class LocalFeedManager {
    #storageDir: LocalFilePath
    _feedsConfig: FeedsConfigRAM | null = null // The config will be loaded from disk as need. Contains all the private keys for the feeds and the local name/ID associations.
    constructor(storageDir: LocalFilePath) {
        if (!fs.existsSync(storageDir.toString())) {
            throw Error(`Storage directory does not exist: ${storageDir}`)
        }
        this.#storageDir = storageDir
    }
    async createFeed(feedName: FeedName | null): Promise<FeedId> {
        // Create a new writeable feed on this node and return the ID of the new feed

        // Generate the crypto keypair. The publicKey determines the new feed ID
        const {publicKey, privateKey} = createKeyPair();
        const feedId = publicKeyHexToFeedId(publicKeyToHex(publicKey));

        // Load and modify the config (which contains the private keys and associates names to feed IDs)
        const config = await this._loadFeedsConfig();
        config.feeds.set(feedId, {
            publicKey: publicKeyToHex(publicKey),
            privateKey: privateKeyToHex(privateKey)
        });
        if (feedName)
            config.feedIdsByName.set(feedName, feedId);
        await this._saveFeedsConfig(config);

        // Create the feed directory for the actual feed
        await _createFeedDirectoryIfNeeded(this.#storageDir, feedId);

        // Return the feed ID
        return feedId;
    }
    async deleteFeed(feedId: FeedId) {
        const dirPath = _feedDirectory(this.#storageDir, feedId);
        await fs.promises.rmdir(dirPath, {recursive: true});

        const config = await this._loadFeedsConfig();
        if (config.feeds.has(feedId)) {
            config.feeds.delete(feedId);
        }
        config.feedIdsByName.forEach((feedId, feedName) => {
            if (config.feedIdsByName.get(feedName) === feedId) {
                config.feedIdsByName.delete(feedName)
            }
        })
        await this._saveFeedsConfig(config);
    }
    async getFeedId(feedName: FeedName) {
        // assert(typeof(feedName) === 'string');
        // Look up the feed ID for a particular feed name by consulting the config file
        const config = await this._loadFeedsConfig();
        const feedId = config.feedIdsByName.get(feedName) || null;
        if (feedId) {
            // Return null if we don't actually have the feed directory
            if (!fs.existsSync(_feedDirectory(this.#storageDir, feedId))) {
                return null;
            }
        }
        return feedId;
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
        const config = await this._loadFeedsConfig();
        const x = config.feeds.get(feedId)
        if (x) {
            return x.privateKey ? hexToPrivateKey(x.privateKey) : null
        }
        else {
            return null
        }
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
    async _loadFeedsConfig(): Promise<FeedsConfigRAM> {
        // Load the configuration for all feeds, if not already loaded
        // This contains all the private keys for the feeds as well as the local name/ID associations for feed

        // Only load if not already in memory
        if (this._feedsConfig) {
            return this._feedsConfig;
        }
        else {
            const configDir = process.env.KACHERY_P2P_CONFIG_DIR || `${os.homedir()}/.kachery-p2p`;
            const x = await readJsonFile(configDir + '/feeds.json', {});
            if (isFeedsConfig(x)) {
                x.feeds = x.feeds || {};
                x.feedIdsByName = x.feedIdsByName || {};
                this._feedsConfig = toFeedsConfigRAM(x);
                return this._feedsConfig;
            }
            else {
                throw Error(`Error loading feeds config from: ${configDir}/feeds.json`);
            }
        }
    }
    async _saveFeedsConfig(config: FeedsConfigRAM) {
        // Store the configuration for all feeds
        // This contains all the private keys for the feeds as well as the local name/ID associations for feed

        this._feedsConfig = config;
        const configDir = process.env.KACHERY_P2P_CONFIG_DIR || `${os.homedir()}/.kachery-p2p`;
        await writeJsonFile(configDir + '/feeds.json', toFeedsConfig(this._feedsConfig));
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