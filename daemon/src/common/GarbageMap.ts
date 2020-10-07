import { elapsedSince, nowTimestamp, Timestamp } from '../interfaces/core'
import { DurationMsec, durationMsecToNumber } from '../udp/UdpCongestionManager'
import { sleepMsec } from './util'

export default class GarbageMap<Key, Value> {
    #map = new Map<Key, {value: Value, timestamp: Timestamp}>()
    #expirationTimeoutMsec: DurationMsec
    #garbageCollectionRunning = false
    constructor(expirationTimeoutMSec: DurationMsec) {
        this.#expirationTimeoutMsec = expirationTimeoutMSec
    }
    get(key: Key): Value | undefined {
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
        if (!this.#garbageCollectionRunning) {
            this.#garbageCollectionRunning = true;
            this._startGarbageCollection();
        }
    }
    delete(key: Key) {
        this.#map.delete(key)
    }
    has(key: Key) {
        return this.#map.has(key)
    }
    async _startGarbageCollection() {
        while (true) {
            let hasSomething = false;
            let keysToDelete: Key[] = [];
            this.#map.forEach((v, k) => {
                hasSomething = true;
                const elapsed = elapsedSince(v.timestamp);
                if (elapsed > durationMsecToNumber(this.#expirationTimeoutMsec)) {
                    keysToDelete.push(k)
                }
            })
            keysToDelete.forEach(k => {
                this.#map.delete(k)
            })
            if (!hasSomething) {
                this.#garbageCollectionRunning = false;
                return;
            }
            await sleepMsec(10000);
        }
    }
}