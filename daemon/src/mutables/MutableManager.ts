import { JSONStringifyDeterministic } from "../common/crypto_util"
import GarbageMap from "../common/GarbageMap"
import { JSONValue, LocalFilePath, localFilePath, scaledDurationMsec, Sha1Hash, sha1OfObject, sha1OfString } from "../interfaces/core"
import KacheryP2PNode from "../KacheryP2PNode"
import MutableDatabase from "./MutableDatabase"

export type MutableRecord = {
    key: JSONValue
    value: JSONValue
}

export default class MutableManager {
    // Manages the mutables
    #memoryCache = new GarbageMap<Sha1Hash, MutableRecord>(scaledDurationMsec(1000 * 60 * 10))
    #mutableDatabase: MutableDatabase
    #onSetCallbacks: ((key: JSONValue) => void)[] = []
    constructor(storageDir: LocalFilePath) {
        this.#mutableDatabase = new MutableDatabase(localFilePath(storageDir + '/mutables.db'))
    }
    async set(key: JSONValue, value: JSONValue): Promise<void> {
        const sha1 = sha1OfString(JSONStringifyDeterministic(key as Object))
        const rec: MutableRecord = {key, value}
        await this.#mutableDatabase.set(sha1, rec)
        this.#memoryCache.set(sha1, rec)
        this.#onSetCallbacks.forEach(cb => {cb(key)})
    }
    async get(key: JSONValue): Promise<MutableRecord | undefined> {
        const sha1 = sha1OfString(JSONStringifyDeterministic(key as Object))
        const rec = this.#memoryCache.get(sha1)
        if (rec !== undefined) {
            return rec
        }
        const rec2 = await this.#mutableDatabase.get(sha1)
        return rec2
    }
    async delete(key: JSONValue): Promise<void> {
        const sha1 = sha1OfString(JSONStringifyDeterministic(key as Object))
        await this.#mutableDatabase.delete(sha1)
        this.#memoryCache.delete(sha1)
    }
    onSet(callback: (key: JSONValue) => void) {
        this.#onSetCallbacks.push(callback)
    }
}