import { IsDataProxy, IsMessageProxy } from "../cli";
import { sleepMsec } from "../common/util";
import { ChannelConfigUrl, DurationMsec, feedName, isArrayOf, isBoolean, isChannelConfigUrl, optional, sha1OfString, subfeedHash, _validateObject } from "../interfaces/core";
import KacheryP2PNode from "../KacheryP2PNode";

export interface JoinedChannelConfig {
    channelConfigUrl: ChannelConfigUrl
    isMessageProxy?: IsMessageProxy
    isDataProxy?: IsDataProxy
}

export const isJoinedChannelConfig = (x: any): x is JoinedChannelConfig => {
    return _validateObject(x, {
        channelConfigUrl: isChannelConfigUrl,
        isMessageProxy: optional(isBoolean),
        isDataProxy: optional(isBoolean)
    })
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
    constructor(node: KacheryP2PNode, private opts: {intervalMsec: DurationMsec}) {
        this.#node = node

        this._start()
    }
    stop() {
        this.#halted = true
    }
    async _start() {
        while (true) {
            if (this.#halted) return
            const configFeedId = await this.#node.feedManager().getFeedId({feedName: feedName('_kachery_p2p_config')})
            if (configFeedId) {
                const joinedChannelsSubfeedHash = subfeedHash(sha1OfString('joined-channels'))
                const joinedChannelsConfig = await this.#node.feedManager().getFinalMessage({feedId: configFeedId, subfeedHash: joinedChannelsSubfeedHash})
                if (joinedChannelsConfig) {
                    if (isJoinedChannelsConfig(joinedChannelsConfig)) {
                        const joinedChannels: JoinedChannelConfig[] = []
                        for (let joinedChannel of joinedChannelsConfig.joinedChannels) {
                            if (await this.#node.nodeIsAuthorizedForChannel(this.#node.nodeId(), joinedChannel.channelConfigUrl)) {
                                joinedChannels.push(joinedChannel)
                            }
                            else {
                                console.warn(`Not authorized to join channel: ${joinedChannel.channelConfigUrl}`)
                            }
                        }
                        this.#node.setJoinedChannels(joinedChannels)
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