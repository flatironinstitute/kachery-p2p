import fs from 'fs';
import { createKeyPair, hexToPrivateKey, JSONStringifyDeterministic, privateKeyToHex, publicKeyHexToFeedId, publicKeyToHex } from '../../common/crypto_util';
import GarbageMap from '../../common/GarbageMap';
import { FeedId, FeedName, isFeedId, isJSONObject, isPrivateKeyHex, localFilePath, LocalFilePath, PrivateKey, PrivateKeyHex, scaledDurationMsec, SignedSubfeedMessage, SubfeedAccessRules, SubfeedHash, _validateObject } from '../../interfaces/core';
import LocalFeedsDatabase from './LocalFeedsDatabase';
import LocalFeedsDatabaseOld from './LocalFeedsDatabaseOld';

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
            else {
                throw Error(`Problem with feed config file: ${dirPath}/config.json`)
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
    #localFeedsDatabase: LocalFeedsDatabase
    #localFeedsDatabaseOld: LocalFeedsDatabaseOld
    constructor(storageDir: LocalFilePath, configDir: LocalFilePath) {
        if (!fs.existsSync(storageDir.toString())) {
            throw Error(`Storage directory does not exist: ${storageDir}`)
        }
        this.#storageDir = storageDir
        this.#configDir = configDir
        this.#feedsConfigManager = new FeedsConfigManager(this.#configDir, {useMemoryCache: true}) // todo: need to test this for both false and true
        this.#localFeedsDatabase = new LocalFeedsDatabase(localFilePath(storageDir + '/feeds.db'))
        this.#localFeedsDatabaseOld = new LocalFeedsDatabaseOld(storageDir)
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

        await this.#localFeedsDatabase.addFeed(feedId)

        // Return the feed ID
        return feedId
    }
    async deleteFeed(feedId: FeedId) {
        await this.#localFeedsDatabase.deleteFeed(feedId)
        await this.#feedsConfigManager.deleteFeed(feedId)
    }
    async getFeedId(feedName: FeedName): Promise<FeedId | null> {
        // assert(typeof(feedName) === 'string');
        // Look up the feed ID for a particular feed name by consulting the config file

        const feedId = await this.#feedsConfigManager.getFeedIdForName(feedName)
        if (feedId) {
            const existsLocally = await this.feedExistsLocally(feedId)
            if (!existsLocally) return null
        }
        return feedId
    }
    async hasWriteableFeed(feedId: FeedId) {
        // Check whether this node has a writeable feed.
        // We do this by ensuring that we have the associated private key and that the feed directory exists
        const privateKey = await this.getPrivateKeyForFeed(feedId)
        if (!privateKey) return false
        // Returns true if we have the writeable feed
        return await this.feedExistsLocally(feedId)
    }
    async getPrivateKeyForFeed(feedId: FeedId): Promise<PrivateKey | null> {
        // Consult the config to get the private key associated with a particular feed ID
        const c = await this.#feedsConfigManager.getFeedConfig(feedId)
        return c ? hexToPrivateKey(c.privateKey) : null
    }
    async feedExistsLocally(feedId: FeedId): Promise<boolean> {
        return await this.#localFeedsDatabase.hasFeed(feedId)
    }
    async getSignedSubfeedMessages(feedId: FeedId, subfeedHash: SubfeedHash): Promise<SignedSubfeedMessage[]> {
        // Read the messages file
        return await this.#localFeedsDatabase.getSignedSubfeedMessages(feedId, subfeedHash)
    }
    async getSubfeedAccessRules(feedId: FeedId, subfeedHash: SubfeedHash): Promise<SubfeedAccessRules | null> {
        return await this.#localFeedsDatabase.getSubfeedAccessRules(feedId, subfeedHash)
    }
    async appendSignedMessagesToSubfeed(feedId: FeedId, subfeedHash: SubfeedHash, messages: SignedSubfeedMessage[]) {
        await this.#localFeedsDatabase.appendSignedMessagesToSubfeed(feedId, subfeedHash, messages)
    }
    async setSubfeedAccessRules(feedId: FeedId, subfeedHash: SubfeedHash, accessRules: SubfeedAccessRules): Promise<void> {
        await this.#localFeedsDatabase.setSubfeedAccessRules(feedId, subfeedHash, accessRules)
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

const writeJsonFile = async (path: string, obj: Object) => {
    const txt = JSONStringifyDeterministic(obj, 4);
    await fs.promises.writeFile(path, txt);
}