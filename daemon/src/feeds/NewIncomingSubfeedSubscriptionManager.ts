import { TIMEOUTS } from "../common/constants"
import GarbageMap from "../common/GarbageMap"
import { ChannelName, DurationMsec, durationMsecToNumber, elapsedSince, FeedId, NodeId, nowTimestamp, scaledDurationMsec, SignedSubfeedMessage, SubfeedHash, subfeedPosition, SubfeedPosition, zeroTimestamp } from "../interfaces/core"
import { isReportSubfeedMessagesResponseData, ReportSubfeedMessagesRequestData } from "../interfaces/NodeToNodeRequest"
import KacheryP2PNode from "../KacheryP2PNode"

class NewIncomingSubfeedSubscriptionManager {
    #incomingSubscriptions = new GarbageMap<string, IncomingSubfeedSubscription>(scaledDurationMsec(300 * 60 * 1000))
    #subscriptionCodesBySubfeedCode = new GarbageMap<string, { [key: string]: boolean }>(scaledDurationMsec(300 * 60 * 1000))
    constructor(private node: KacheryP2PNode) {
    }
    createOrRenewIncomingSubscription(remoteNodeId: NodeId, channelName: ChannelName, feedId: FeedId, subfeedHash: SubfeedHash, position: SubfeedPosition, durationMsec: DurationMsec) {
        const subscriptionCode = makeSubscriptionCode(remoteNodeId, channelName, feedId, subfeedHash)
        const subfeedCode = makeSubfeedCode(feedId, subfeedHash)
        this.#subscriptionCodesBySubfeedCode.set(subfeedCode, {...this.#subscriptionCodesBySubfeedCode.get(subfeedCode) || {}, [subscriptionCode]: true})
        let S = this.#incomingSubscriptions.get(subfeedCode)
        if (!S) {
            // CHAIN:get_remote_messages:step(12)
            S = new IncomingSubfeedSubscription(this.node, remoteNodeId, channelName, feedId, subfeedHash)
            this.#incomingSubscriptions.set(subfeedCode, S)
        }
        S.renew(position, durationMsec)
        setTimeout(() => {
            this._checkRemove(remoteNodeId, channelName, feedId, subfeedHash)
        }, durationMsecToNumber(durationMsec) + durationMsecToNumber(scaledDurationMsec(5000)))
    }
    reportMessagesAdded(feedId: FeedId, subfeedHash: SubfeedHash, position: SubfeedPosition, signedMessages: SignedSubfeedMessage[]) {
        const subfeedCode = makeSubfeedCode(feedId, subfeedHash)
        const x = this.#subscriptionCodesBySubfeedCode.get(subfeedCode) || {}
        for (let subscriptionCode in x) {
            const s = this.#incomingSubscriptions.get(subscriptionCode)
            if (s) {
                // CHAIN:get_remote_messages:step(13)
                this._sendMessages(s.remoteNodeId, s.channelName, s.feedId, s.subfeedHash, position, signedMessages).then(() => {}).catch((err: Error) => {
                    console.warn(`Problem sending subfeed messages to remote node: ${err.message}`)
                })
            }
        }
    }
    async _sendMessages(toNodeId: NodeId, channelName: ChannelName, feedId: FeedId, subfeedHash: SubfeedHash, position: SubfeedPosition, signedMessages: SignedSubfeedMessage[]) {
        // CHAIN:get_remote_messages:step(14)
        const requestData: ReportSubfeedMessagesRequestData = {
            requestType: 'reportSubfeedMessages',
            feedId,
            subfeedHash,
            position,
            signedMessages
        }
        const responseData = await this.node.remoteNodeManager().sendRequestToNode(toNodeId, channelName, requestData, { timeoutMsec: TIMEOUTS.defaultRequest, method: 'default' })
        if (!isReportSubfeedMessagesResponseData(responseData)) {
            throw Error('Unexpected response to reportSubfeedMessages request')
        }
        if (!responseData.success) {
            throw Error(`Error in reportSubfeedMessages: ${responseData.errorMessage}`)
        }
    }
    _checkRemove(remoteNodeId: NodeId, channelName: ChannelName, feedId: FeedId, subfeedHash: SubfeedHash) {
        const subfeedCode = makeSubscriptionCode(remoteNodeId, channelName, feedId, subfeedHash)
        const S = this.#incomingSubscriptions.get(subfeedCode)
        if (!S) return
        const elapsedMsec = S.elapsedMsecSinceLastRenew()
        if (elapsedMsec > durationMsecToNumber(S.durationMsec())) {
            this.#incomingSubscriptions.delete(subfeedCode)
        }
    }
}

const makeSubscriptionCode = (remoteNodeId: NodeId, channelName: ChannelName, feedId: FeedId, subfeedHash: SubfeedHash) => {
    return remoteNodeId + ':' + channelName + ':' + feedId.toString() + ':' + subfeedHash.toString()
}

const makeSubfeedCode = (feedId: FeedId, subfeedHash: SubfeedHash) => {
    return feedId.toString() + ':' + subfeedHash.toString()
}

class IncomingSubfeedSubscription {
    #lastRenewTimestamp = zeroTimestamp()
    #lastRenewDurationMsec: DurationMsec = 0 as any as DurationMsec
    #lastRenewSubfeedPosition: SubfeedPosition = subfeedPosition(0)
    #active = true
    constructor(private node: KacheryP2PNode, public remoteNodeId: NodeId, public channelName: ChannelName, public feedId: FeedId, public subfeedHash: SubfeedHash) {
    }
    renew(position: SubfeedPosition, durationMsec: DurationMsec) {
        this.#lastRenewTimestamp = nowTimestamp()
        this.#lastRenewDurationMsec = durationMsec
        this.#lastRenewSubfeedPosition = position
    }
    deactivate() {
        this.#active = false
    }
    elapsedMsecSinceLastRenew() {
        return elapsedSince(this.#lastRenewTimestamp)
    }
    durationMsec() {
        return this.#lastRenewDurationMsec
    }
}

export default NewIncomingSubfeedSubscriptionManager