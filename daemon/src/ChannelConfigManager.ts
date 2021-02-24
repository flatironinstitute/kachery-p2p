import axios from 'axios';
import yaml from 'js-yaml';
import { ChannelConfig, isChannelConfig } from "./cli";
import GarbageMap from "./common/GarbageMap";
import { randomAlphaString } from "./common/util";
import { ChannelConfigUrl, elapsedSince, nowTimestamp, scaledDurationMsec, Timestamp } from "./interfaces/core";

type ChannelConfigRecord = {
    channelConfigUrl: ChannelConfigUrl
    timestamp: Timestamp
    channelConfig: ChannelConfig
}

class ChannelConfigManager {
    #records = new GarbageMap<ChannelConfigUrl, ChannelConfigRecord>(scaledDurationMsec(1000 * 60 * 30))
    constructor() {
    }
    async getChannelConfig(channelConfigUrl: ChannelConfigUrl): Promise<ChannelConfig | null> {
        const a = this.#records.get(channelConfigUrl)
        if (a) {
            const elapsed = elapsedSince(a.timestamp)
            if (elapsed < 1000 * 60 * 3) {
                return a.channelConfig
            }
            else {
                const b = await this._fetchChannelConfigRecord(channelConfigUrl)
                if (b) return b.channelConfig
                else return a.channelConfig
            }
        }
        else {
            const b = await this._fetchChannelConfigRecord(channelConfigUrl)
            if (b) return b.channelConfig
            else return null
        }
    }
    getChannelConfigSync(channelConfigUrl: ChannelConfigUrl): ChannelConfig | null {
        this.getChannelConfig(channelConfigUrl) // trigger a get
        const a = this.#records.get(channelConfigUrl)
        if (a) {
            return a.channelConfig
        }
        else return null
    }
    async _fetchChannelConfigRecord(channelConfigUrl: ChannelConfigUrl): Promise<ChannelConfigRecord | null> {
        try {
            const config = await loadConfig(channelConfigUrl.toString())
            if (config) {
                if (isChannelConfig(config)) {
                    const r: ChannelConfigRecord = {
                        channelConfig: config,
                        timestamp: nowTimestamp(),
                        channelConfigUrl
                    }
                    this.#records.set(channelConfigUrl, r)
                    return r
                }
                else {
                    console.warn(`Invalid channel config for: ${channelConfigUrl}`)
                    return null
                }
            }
            else return null
        }
        catch(err) {
            return null
        }
    }
}

const cacheBust = (url: string) => {
    if (url.includes('?')) {
        return url + `&cb=${randomAlphaString(10)}`
    }
    else {
        return url + `?cb=${randomAlphaString(10)}`
    }
}

const loadConfig = async (url: string) => {
    let txt: string
    txt = (await axios.get(cacheBust(url))).data
    return yaml.safeLoad(txt)
}

export default ChannelConfigManager