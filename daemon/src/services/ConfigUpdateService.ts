import { IsDataProxy, IsMessageProxy, IsPublic } from "../cli";
import { loadYamlFromPathOrUrl, sleepMsec } from "../common/util";
import { ChannelConfigUrl, DurationMsec, feedName, isArrayOf, isBoolean, isChannelConfigUrl, isString, JSONValue, optional, Sha1Hash, sha1OfString, subfeedHash, _validateObject } from "../interfaces/core";
import KacheryP2PNode from "../KacheryP2PNode";

export interface JoinedChannelConfig {
    channelConfigUrl: ChannelConfigUrl
    isMessageProxy?: IsMessageProxy
    isDataProxy?: IsDataProxy
    isPublic?: IsPublic
}

export const isJoinedChannelConfig = (x: any): x is JoinedChannelConfig => {
    return _validateObject(x, {
        channelConfigUrl: isChannelConfigUrl,
        isMessageProxy: optional(isBoolean),
        isDataProxy: optional(isBoolean),
        isPublic: optional(isBoolean)
    }, {allowAdditionalFields: true})
}

export interface MirrorSourceConfig {
    uri: string
    label?: string
}

export const isMirrorSourceConfig = (x: any): x is MirrorSourceConfig => {
    return _validateObject(x, {
        uri: isString,
        label: optional(isString)
    }, {allowAdditionalFields: true})
}

interface JoinedChannelsConfig {
    joinedChannels: JoinedChannelConfig[]
}

const isJoinedChannelsConfig = (x: any): x is JoinedChannelsConfig => {
    return _validateObject(x, {
        joinedChannels: isArrayOf(isJoinedChannelConfig)
    })
}

export default class ConfigUpdateService {
    #node: KacheryP2PNode
    #halted = false
    constructor(node: KacheryP2PNode, private opts: {intervalMsec: DurationMsec, staticConfigPathOrUrl: string | null}) {
        this.#node = node

        this._start()
    }
    stop() {
        this.#halted = true
    }
    async _start() {
        if (this.opts.staticConfigPathOrUrl) {
            const config = await loadYamlFromPathOrUrl(this.opts.staticConfigPathOrUrl) as any
            if (config.joinedChannels) {
                // todo: this code is duplicated below
                const joinedChannels: JoinedChannelConfig[] = []
                for (let joinedChannel of config.joinedChannels) {
                    if (isJoinedChannelConfig(joinedChannel)) {
                        joinedChannels.push(joinedChannel)
                    }
                    else {
                        console.warn(joinedChannel)
                        console.warn('Invalid joined channel config')
                    }
                }
                this.#node.setJoinedChannels(joinedChannels)
            }
            if (config.mirrorSources) {
                const mirrorSources: MirrorSourceConfig[] = []
                for (let mirrorSource of config.mirrorSources) {
                    if (isMirrorSourceConfig(mirrorSource)) {
                        mirrorSources.push(mirrorSource)
                    }
                    else {
                        console.warn(mirrorSource)
                        console.warn('Invalid mirror source config')
                    }
                }
                this.#node.setMirrorSources(mirrorSources)
            }
        }
        while (true) {
            if (this.#halted) return
            if (!this.opts.staticConfigPathOrUrl) {
                let joinedChannelsConfigMutable = await this.#node.mutableManager().get('_joined_channels_config')
                let joinedChannelsConfig = joinedChannelsConfigMutable ? joinedChannelsConfigMutable.value : null
                if (!joinedChannelsConfig) {
                    // retrieve config from old method //////////////////////////////////////////////////////
                    const configFeedId = await this.#node.feedManager().getFeedId({feedName: feedName('_kachery_p2p_config')})
                    if (configFeedId) {
                        const joinedChannelsSubfeedHash = subfeedHash(sha1OfString('joined-channels'))
                        const c = await this.#node.feedManager().getFinalLocalMessage({feedId: configFeedId, subfeedHash: joinedChannelsSubfeedHash})
                        if (c) {
                            joinedChannelsConfig = c as any as JSONValue
                            await this.#node.mutableManager().set('_joined_channels_config', c)
                        }
                    }
                    //////////////////////////////////////////////////////////////////////////////////////////
                }
                if (joinedChannelsConfig) {
                    if (isJoinedChannelsConfig(joinedChannelsConfig)) {
                        this.#node.setJoinedChannels(joinedChannelsConfig.joinedChannels)
                    }
                    else {
                        console.warn(joinedChannelsConfig)
                        console.warn('Invalid joined channels config')
                    }
                }
            }
            await sleepMsec(this.opts.intervalMsec, () => {return !this.#halted})
        }
    }
}