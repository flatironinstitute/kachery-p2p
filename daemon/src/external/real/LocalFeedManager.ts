import fs from 'fs';
import { createKeyPair, hexToPrivateKey, JSONStringifyDeterministic, privateKeyToHex, publicKeyHexToFeedId, publicKeyToHex } from '../../common/crypto_util';
import GarbageMap from '../../common/GarbageMap';
import { isReadableByOthers } from '../../common/util';
import { FeedId, FeedName, isFeedId, isJSONObject, isPrivateKeyHex, JSONValue, localFilePath, LocalFilePath, PrivateKey, PrivateKeyHex, scaledDurationMsec, SignedSubfeedMessage, SubfeedAccessRules, SubfeedHash, _validateObject } from '../../interfaces/core';
import MutableManager from '../../mutables/MutableManager';
import LocalFeedsDatabase from './LocalFeedsDatabase';

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

class OldFeedsConfigManager {
    #feedsConfigMemCache = new GarbageMap<FeedId, FeedConfig>(scaledDurationMsec(60 * 60 * 1000))
    #feedIdsByNameMemCache = new GarbageMap<FeedName, FeedId>(scaledDurationMsec(60 * 60 * 1000))
    constructor(private configDir: LocalFilePath, private opts: {useMemoryCache: boolean}) {
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
        await writeJsonFile(`${dirPath}/config.json`, config, fs.constants.S_IRUSR | fs.constants.S_IWUSR)

        this.#feedsConfigMemCache.set(feedId, {feedId, privateKey})
    }
    async getFeedConfig(feedId: FeedId): Promise<FeedConfig | null> {
        const c = this.#feedsConfigMemCache.get(feedId)
        if ((c) && (this.opts.useMemoryCache)) {
            return c
        }
        const dirPath = await this._feedConfigDirectory(feedId, {create: false})
        if (fs.existsSync(dirPath.toString())) {
            const configPath = `${dirPath}/config.json`
            if (isReadableByOthers(configPath)) {
                fs.chmodSync(configPath, fs.constants.S_IRUSR | fs.constants.S_IWUSR)
                if (isReadableByOthers(configPath)) {
                    throw Error(`Feed config file is readable by others even after setting permissions: ${configPath}`)
                }
            }            
            const config = await readJsonFile(configPath, {})
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
        const ret = `${this.configDir}/feeds/${f[0]}${f[1]}/${f[2]}${f[3]}/${f[4]}${f[5]}/${f}`
        if (opts.create) {
            if (!fs.existsSync(ret)) {
                await fs.promises.mkdir(ret, {recursive: true})
            }
        }
        return localFilePath(ret)
    }
    async _feedIdByNamePath(feedName: FeedName, opts: {create: boolean}): Promise<LocalFilePath> {
        const f = feedName
        const p = `${this.configDir}/feeds/byName`
        if (opts.create) {
            if (!fs.existsSync(p)) {
                await fs.promises.mkdir(p, {recursive: true})
            }
        }
        return localFilePath(`${p}/${feedName}.json`)
    }
    _migration_getAllFeedIds(): FeedId[] {
        const checkDirectory = (path: string) => {
            if (!fs.existsSync(path)) return []
            const ret: FeedId[] = []
            for (let fname of fs.readdirSync(path)) {
                const path2 = `${path}/${fname}`
                if (fname === 'config.json') {
                    const config = JSON.parse(fs.readFileSync(path2, {encoding: 'utf-8'}))
                    ret.push(config.feedId)
                }
                if (fs.statSync(path2).isDirectory()) {
                    const ret2 = checkDirectory(path2)
                    for (let x of ret2) ret.push(x)
                }
            }
            return ret
        }
        return checkDirectory(`${this.configDir}/feeds`)
    }
    _migration_getAllFeedNames(): FeedName[] {
        const p = `${this.configDir}/feeds/byName`
        if (!fs.existsSync(p)) return []
        const ret: FeedName[] = []
        for (let fname of fs.readdirSync(p)) {
            if (fname.endsWith('.json')) {
                const path2 = `${p}/${fname}`
                const a = JSON.parse(fs.readFileSync(path2, {encoding: 'utf-8'}))
                // const feedId = a.feedId
                const feedName = a.feedName
                ret.push(feedName)
            }
        }
        return ret
    }
    _migration_deleteFeedIdForName(feedName: FeedName) {
        const p = `${this.configDir}/feeds/byName`
        if (!fs.existsSync(p)) throw Error(`Unable to delete feedId for name: byName directory does not exist: ${feedName} ${p}`)
        const ret: FeedName[] = []
        for (let fname of fs.readdirSync(p)) {
            if (fname.endsWith('.json')) {
                const path2 = `${p}/${fname}`
                const a = JSON.parse(fs.readFileSync(path2, {encoding: 'utf-8'}))
                // const feedId = a.feedId
                if (a.feedName === feedName.toString()) {
                    fs.unlinkSync(path2)
                    return
                }
            }
        }
        throw Error(`Unable to delete feedId for name: ${feedName}`)
    }
}

class FeedsConfigManager {
    constructor(private mutableManager: MutableManager, private configDir: LocalFilePath) {
        if (fs.existsSync(`${configDir}/feeds`)) {
            const M = new OldFeedsConfigManager(configDir, {useMemoryCache: false})

            const allFeedIds: FeedId[] = M._migration_getAllFeedIds()
            for (let feedId of allFeedIds) {
                console.info(`Migrating feed to new system: ${feedId}`)
                M.getFeedConfig(feedId).then(feedConfig => {
                    if (feedConfig) {
                        this.addFeed(feedId, feedConfig.privateKey).then(() => {
                            M.deleteFeed(feedId).catch((err: Error) => {
                                console.warn(`Problem deleting feed config during migration: ${feedId} (${err.message})`)
                            })
                        }).catch((err: Error) => {
                            console.warn(`Problem adding feed config during migration: ${feedId} (${err.message})`)
                        })
                    }
                }).catch((err: Error) => {
                    console.warn(`Problem getting feed config during migration: ${feedId} (${err.message})`)
                })
            }

            const allFeedNames: FeedName[] = M._migration_getAllFeedNames()
            for (let feedName of allFeedNames) {
                console.info(`Migrating feed name to new system: ${feedName}`)
                M.getFeedIdForName(feedName).then(feedId => {
                    if (feedId) {
                        this.setFeedIdForName(feedName, feedId).then(() => {
                            try {
                                M._migration_deleteFeedIdForName(feedName)
                            }
                            catch (err) {
                                console.warn(`Problem deleting feed id for name during migration: ${feedName} ${feedId} (${err.message})`)
                            }
                        }).catch((err: Error) => {
                            console.warn(`Problem setting feed for name during migration: ${feedName} ${feedId} (${err.message})`)
                        })
                    }
                }).catch((err: Error) => {
                    console.warn(`Problem getting feed for name during migration: ${feedName} (${err.message})`)
                })
            }
        }
    }

    async addFeed(feedId: FeedId, privateKey: PrivateKeyHex) {
        const c = await this.getFeedConfig(feedId)
        if (c) {
            throw Error('Cannot add feed. Feed with this ID already exists')
        }
        const config: FeedConfig = {
            feedId, privateKey
        }
        await this.mutableManager.set({type: 'feedConfig', feedId: feedId.toString()}, config as any as JSONValue)
    }
    async getFeedConfig(feedId: FeedId): Promise<FeedConfig | null> {
        const r = await this.mutableManager.get({type: 'feedConfig', feedId: feedId.toString()})
        if (!r) return null
        const config = r.value
        if (!isFeedConfig(config)) {
            throw Error(`Not a valid feed config for feed: ${feedId}`)
        }
        return config
    }
    async deleteFeed(feedId: FeedId) {
        await this.mutableManager.delete({type: 'feedConfig', feedId: feedId.toString()})
    }
    async setFeedIdForName(feedName: FeedName, feedId: FeedId) {
        await this.mutableManager.set({type: 'feedIdForName', feedName: feedName.toString()}, feedId.toString())
    }
    async getFeedIdForName(feedName: FeedName): Promise<FeedId | null> {
        const x = await this.mutableManager.get({type: 'feedIdForName', feedName: feedName.toString()})
        if (!x) return null
        const feedId = x.value
        if (!isFeedId(feedId)) {
            throw Error(`Not a valid feed ID for name: ${feedName} ${feedId}`)
        }
        return feedId
    }
}

export default class LocalFeedManager {
    #feedsConfigManager: FeedsConfigManager
    #localFeedsDatabase: LocalFeedsDatabase
    // #localFeedsDatabaseOld: LocalFeedsDatabaseOld
    constructor(storageDir: LocalFilePath, mutableManager: MutableManager, configDir: LocalFilePath) {
        if (!fs.existsSync(storageDir.toString())) {
            throw Error(`Storage directory does not exist: ${storageDir}`)
        }
        this.#feedsConfigManager = new FeedsConfigManager(mutableManager, configDir)
        this.#localFeedsDatabase = new LocalFeedsDatabase(localFilePath(storageDir + '/feeds.db'))
        // this.#localFeedsDatabaseOld = new LocalFeedsDatabaseOld(storageDir)
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

const writeJsonFile = async (path: string, obj: Object, mode?: fs.Mode) => {
    const txt = JSONStringifyDeterministic(obj, 4);
    await fs.promises.writeFile(path, txt, {mode});
}