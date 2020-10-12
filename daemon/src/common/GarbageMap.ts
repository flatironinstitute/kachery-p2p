import { elapsedSince, nowTimestamp, Timestamp } from '../interfaces/core'
import { DurationMsec, durationMsecToNumber } from '../udp/UdpCongestionManager'

export default class GarbageMap<Key, Value> {
    #map = new Map<Key, {value: Value, timestamp: Timestamp}>()
    #expirationTimeoutMsec: DurationMsec
    #lastCheckTimestamp = nowTimestamp()
    constructor(expirationTimeoutMSec: DurationMsec) {
        this.#expirationTimeoutMsec = expirationTimeoutMSec
    }
    get(key: Key): Value | undefined {
        this._checkGarbageCollection()
        const x = this.#map.get(key)
        if (x) {
            return x.value
        }
        else {
            return undefined
        }
    }
    set(key: Key, value: Value) {
        this.#map.set(key, {
            value,
            timestamp: nowTimestamp()
        })
        this._checkGarbageCollection()
    }
    delete(key: Key) {
        this.#map.delete(key)
        this._checkGarbageCollection()
    }
    has(key: Key) {
        return this.#map.has(key)
    }
    async _checkGarbageCollection() {
        const elapsedSinceCheck = elapsedSince(this.#lastCheckTimestamp)
        if (elapsedSinceCheck > durationMsecToNumber(this.#expirationTimeoutMsec) / 2) {
            this.#lastCheckTimestamp = nowTimestamp()
            let keysToDelete: Key[] = [];
            this.#map.forEach((v, k) => {
                const elapsed = elapsedSince(v.timestamp);
                if (elapsed > durationMsecToNumber(this.#expirationTimeoutMsec)) {
                    keysToDelete.push(k)
                }
            })
            keysToDelete.forEach(k => {
                this.#map.delete(k)
            })
        }
    }
}