import { TIMEOUTS } from "../common/constants"
import GarbageMap from "../common/GarbageMap"
import { ChannelName, DurationMsec, durationMsecToNumber, elapsedSince, FeedId, NodeId, nowTimestamp, scaledDurationMsec, SignedSubfeedMessage, SubfeedHash, SubfeedPosition, zeroTimestamp } from "../interfaces/core"
import { isSubscribeToSubfeedResponseData, SubscribeToSubfeedRequestData } from "../interfaces/NodeToNodeRequest"
import KacheryP2PNode from "../KacheryP2PNode"

class NewOutgoingSubfeedSubscriptionManager {
    #outgoingSubscriptions = new GarbageMap<string, OutgoingSubfeedSubscription>(scaledDurationMsec(300 * 60 * 1000))
    constructor(private node: KacheryP2PNode) {
    }
    async createOrRenewOutgoingSubscription(remoteNodeId: NodeId, channelName: ChannelName, feedId: FeedId, subfeedHash: SubfeedHash, position: SubfeedPosition, durationMsec: DurationMsec): Promise<SignedSubfeedMessage[]> {
        const subfeedCode = makeSubscriptionCode(remoteNodeId, channelName, feedId, subfeedHash)
        let S = this.#outgoingSubscriptions.get(subfeedCode)
        if (!S) {
            S = new OutgoingSubfeedSubscription(this.node, remoteNodeId, channelName, feedId, subfeedHash)
            this.#outgoingSubscriptions.set(subfeedCode, S)
        }
        // CHAIN:get_remote_messages:step(6)
        console.log('-------------------- S6')
        const initialSignedMessages = await S.renew(position, durationMsec)
        setTimeout(() => {
            this._checkRemove(remoteNodeId, channelName, feedId, subfeedHash)
        }, durationMsecToNumber(durationMsec) + durationMsecToNumber(scaledDurationMsec(5000)))
        return initialSignedMessages
    }
    _checkRemove(remoteNodeId: NodeId, channelName: ChannelName, feedId: FeedId, subfeedHash: SubfeedHash) {
        const subfeedCode = makeSubscriptionCode(remoteNodeId, channelName, feedId, subfeedHash)
        const S = this.#outgoingSubscriptions.get(subfeedCode)
        if (!S) return
        const elapsedMsec = S.elapsedMsecSinceLastRenew()
        if (elapsedMsec > durationMsecToNumber(S.durationMsec())) {
            this.#outgoingSubscriptions.delete(subfeedCode)
        }
    }
}

const makeSubscriptionCode = (remoteNodeId: NodeId, channelName: ChannelName, feedId: FeedId, subfeedHash: SubfeedHash) => {
    return remoteNodeId + ':' + channelName + ':' + feedId.toString() + ':' + subfeedHash.toString()
}

class OutgoingSubfeedSubscription {
    #lastRenewTimestamp = zeroTimestamp()
    #lastRenewDurationMsec: DurationMsec = scaledDurationMsec(1000 * 60)
    #initialMessageSent = false
    constructor(private node: KacheryP2PNode, private remoteNodeId: NodeId, private channelName: ChannelName, private feedId: FeedId, private subfeedHash: SubfeedHash) {
    }
    // todo: this needs to be async and returns the intial messages
    async renew(position: SubfeedPosition, durationMsec: DurationMsec): Promise<SignedSubfeedMessage[]> {
        if (this.#initialMessageSent) {
            const elapsedMsec = this.elapsedMsecSinceLastRenew()
            if (elapsedMsec < durationMsecToNumber(scaledDurationMsec(5000))) return []
        }
        this.#lastRenewTimestamp = nowTimestamp()
        this.#initialMessageSent = true
        // CHAIN:get_remote_messages:step(7)
        console.log('-------------------- S7')
        const requestData: SubscribeToSubfeedRequestData = {
            requestType: 'subscribeToSubfeed',
            feedId: this.feedId,
            subfeedHash: this.subfeedHash,
            position,
            durationMsec: durationMsec
        }
        const responseData = await this.node.remoteNodeManager().sendRequestToNode(
            this.remoteNodeId,
            this.channelName,
            requestData,
            {
                timeoutMsec: TIMEOUTS.defaultRequest,
                method: 'default'
            }
        )
        if (!isSubscribeToSubfeedResponseData(responseData)) throw Error('Unexpected response to subscribeToSubfeed')
        if (!responseData.success) throw Error(`Error in response to subscribeToSubfeed: ${responseData.errorMessage}`)
        return responseData.initialSignedMessages || []
    }
    elapsedMsecSinceLastRenew() {
        return elapsedSince(this.#lastRenewTimestamp)
    }
    durationMsec() {
        return this.#lastRenewDurationMsec
    }
}

export default NewOutgoingSubfeedSubscriptionManager