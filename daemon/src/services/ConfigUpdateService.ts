import { sleepMsec } from "../common/util";
import { ChannelConfigUrl, DurationMsec, feedName, isArrayOf, isChannelConfigUrl, sha1OfString, subfeedHash, _validateObject } from "../interfaces/core";
import KacheryP2PNode from "../KacheryP2PNode";

interface JoinedChannelsConfigChannel {
    channelConfigUrl: ChannelConfigUrl
}

const isJoinedChannelsConfigChannel = (x: any): x is JoinedChannelsConfigChannel => {
    return _validateObject(x, {
        channelConfigUrl: isChannelConfigUrl
    })
}

interface JoinedChannelsConfig {
    joinedChannels: JoinedChannelsConfigChannel[]
}

const isJoinedChannelsConfig = (x: any): x is JoinedChannelsConfig => {
    return _validateObject(x, {
        joinedChannels: isArrayOf(isJoinedChannelsConfigChannel)
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
                        const joinedChannels: JoinedChannelsConfigChannel[] = []
                        for (let joinedChannel of joinedChannelsConfig.joinedChannels) {
                            if (await this.#node.nodeIsAuthorizedForChannel(this.#node.nodeId(), joinedChannel.channelConfigUrl)) {
                                joinedChannels.push(joinedChannel)
                            }
                            else {
                                console.warn(`Not authorized to join channel: ${joinedChannel.channelConfigUrl}`)
                            }
                        }
                        const channelConfigUrls = joinedChannels.map(a => a.channelConfigUrl)
                        this.#node.setJoinedChannelConfigUrls(channelConfigUrls)
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