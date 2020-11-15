import { TIMEOUTS } from "../common/constants";
import GarbageMap from "../common/GarbageMap";
import { ChannelName, DurationMsec, durationMsecToNumber, elapsedSince, FeedId, messageCount, NodeId, nowTimestamp, scaledDurationMsec, SignedSubfeedMessage, SubfeedHash, subfeedPosition, SubfeedPosition, Timestamp } from "../interfaces/core";
import { isReportSubfeedMessagesResponseData, ReportSubfeedMessagesRequestData } from "../interfaces/NodeToNodeRequest";
import KacheryP2PNode from "../KacheryP2PNode";

class Subscription {
    #position: SubfeedPosition = subfeedPosition(0)
    #expirationTimestamp = nowTimestamp()
    #onExpiredCallbacks: (() => void)[] = []
    constructor(public nodeId: NodeId, public channelName: ChannelName, public feedId: FeedId, public subfeedHash: SubfeedHash) {
    }
    setPosition(pos: SubfeedPosition) {
        this.#position = pos
    }
    extendDuration(duration: DurationMsec) {
        const newExpirationTimestamp = ((nowTimestamp() as any as number) + (duration as any as number)) as any as Timestamp
        if ((newExpirationTimestamp as any as number) > (this.#expirationTimestamp as any as number)) {
            this.#expirationTimestamp = newExpirationTimestamp
            setTimeout(() => {
                this._checkExpired()
            }, durationMsecToNumber(duration) + durationMsecToNumber(scaledDurationMsec(1000)))
        }
    }
    position() {
        return this.#position
    }
    onExpired(callback: () => void) {
        this.#onExpiredCallbacks.push(callback)
    }
    _checkExpired() {
        const elapsed = elapsedSince(this.#expirationTimestamp)
        if (elapsed > 0) {
            this.#onExpiredCallbacks.forEach(cb => {cb()})
        }
    }
}

class IncomingSubfeedSubscriptionManager {
    #subscriptions = new GarbageMap<string, Subscription>(scaledDurationMsec(20 * 60 * 1000))
    #subscriptionKeysBySubfeedKey = new GarbageMap<string, {[key: string]: boolean}>(scaledDurationMsec(20 * 60 * 1000))
    constructor(private node: KacheryP2PNode) {
    }
    async renewIncomingSubfeedSubscription(fromNodeId: NodeId, channelName: ChannelName, feedId: FeedId, subfeedHash: SubfeedHash, position: SubfeedPosition, durationMsec: DurationMsec): Promise<SignedSubfeedMessage[]> {
        const key0 = fromNodeId + ':' + channelName + ':' + feedId + ':' + subfeedHash
        const key1 = feedId + ':' + subfeedHash
        const tmp = this.#subscriptionKeysBySubfeedKey.getWithDefault(key1, {})
        this.#subscriptionKeysBySubfeedKey.set(key1, {...tmp, key0: true})
        let s = this.#subscriptions.get(key0)
        if (!s) {
            s = new Subscription(fromNodeId, channelName, feedId, subfeedHash)
            this.#subscriptions.set(key0, s)
            s.onExpired(() => {
                this.#subscriptions.delete(key0)
            })
        }
        s.setPosition(position)
        s.extendDuration(durationMsec)
        const signedMessages = await this.node.feedManager().getSignedMessages({feedId, subfeedHash, position, maxNumMessages: messageCount(9999999), waitMsec: scaledDurationMsec(0)})
        return signedMessages
    }
    async reportMessagesAdded(feedId: FeedId, subfeedHash: SubfeedHash, position: SubfeedPosition, signedMessages: SignedSubfeedMessage[]) {
        const key1 = feedId + ':' + subfeedHash
        const keys0 = this.#subscriptionKeysBySubfeedKey.getWithDefault(key1, {})
        for (let key0 in keys0) {
            const s = this.#subscriptions.get(key0)
            if (s) {
                await this._sendMessages(s.nodeId, s.channelName, feedId, subfeedHash, position, signedMessages)
            }
        }
    }
    async _sendMessages(toNodeId: NodeId, channelName: ChannelName, feedId: FeedId, subfeedHash: SubfeedHash, position: SubfeedPosition, signedMessages: SignedSubfeedMessage[]) {
        const requestData: ReportSubfeedMessagesRequestData = {
            requestType: 'reportSubfeedMessages',
            feedId,
            subfeedHash,
            position,
            signedMessages
        }
        const responseData = await this.node.remoteNodeManager().sendRequestToNode(toNodeId, channelName, requestData, {timeoutMsec: TIMEOUTS.defaultRequest, method: 'default'})
        if (!isReportSubfeedMessagesResponseData(responseData)) {
            throw Error('Unexpected response to reportSubfeedMessages request')
        }
        if (!responseData.success) {
            throw Error(`Error in reportSubfeedMessages: ${responseData.errorMessage}`)
        }
    }
}

export default IncomingSubfeedSubscriptionManager