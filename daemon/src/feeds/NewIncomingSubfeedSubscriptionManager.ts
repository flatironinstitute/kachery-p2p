import { TIMEOUTS } from "../common/constants"
import GarbageMap from "../common/GarbageMap"
import { durationMsecToNumber, elapsedSince, FeedId, MessageCount, NodeId, nowTimestamp, scaledDurationMsec, SubfeedHash, zeroTimestamp } from "../interfaces/core"
import { isReportNewSubfeedMessagesResponseData, ReportNewSubfeedMessagesRequestData } from "../interfaces/NodeToNodeRequest"
import KacheryP2PNode from "../KacheryP2PNode"

class NewIncomingSubfeedSubscriptionManager {
    #incomingSubscriptions = new GarbageMap<string, IncomingSubfeedSubscription>(scaledDurationMsec(300 * 60 * 1000))
    #subscriptionCodesBySubfeedCode = new GarbageMap<string, { [key: string]: boolean }>(scaledDurationMsec(300 * 60 * 1000))
    constructor(private node: KacheryP2PNode) {
    }
    createOrRenewIncomingSubscription(remoteNodeId: NodeId, feedId: FeedId, subfeedHash: SubfeedHash) {
        const subscriptionCode = makeSubscriptionCode(remoteNodeId, feedId, subfeedHash)
        const subfeedCode = makeSubfeedCode(feedId, subfeedHash)
        this.#subscriptionCodesBySubfeedCode.set(subfeedCode, {...this.#subscriptionCodesBySubfeedCode.get(subfeedCode) || {}, [subscriptionCode]: true})
        let S = this.#incomingSubscriptions.get(subfeedCode)
        if (!S) {
            // CHAIN:get_remote_messages:step(12)
            S = new IncomingSubfeedSubscription(this.node, remoteNodeId, feedId, subfeedHash)
            this.#incomingSubscriptions.set(subscriptionCode, S)
        }
        S.renew()
        setTimeout(() => {
            this._checkRemove(remoteNodeId, feedId, subfeedHash)
        }, durationMsecToNumber(scaledDurationMsec(60000)))
    }
    reportMessagesAdded(feedId: FeedId, subfeedHash: SubfeedHash, numMessages: MessageCount) {
        const subfeedCode = makeSubfeedCode(feedId, subfeedHash)
        // CHAIN:append_messages:step(11)
        const x = this.#subscriptionCodesBySubfeedCode.get(subfeedCode) || {}
        for (let subscriptionCode in x) {
            const s = this.#incomingSubscriptions.get(subscriptionCode)
            if (s) {
                // CHAIN:get_remote_messages:step(13)
                this._reportNewSubfeedMessages(s.remoteNodeId, s.feedId, s.subfeedHash, numMessages).then(() => {}).catch((err: Error) => {
                    console.warn(`Problem reporting new subfeed messages to remote node: ${err.message}`)
                })
            }
        }
    }
    async _reportNewSubfeedMessages(toNodeId: NodeId, feedId: FeedId, subfeedHash: SubfeedHash, numMessages: MessageCount) {
        // CHAIN:get_remote_messages:step(14)
        const requestData: ReportNewSubfeedMessagesRequestData = {
            requestType: 'reportNewSubfeedMessages',
            feedId,
            subfeedHash,
            numMessages
        }
        const responseData = await this.node.remoteNodeManager().sendRequestToNode(toNodeId, requestData, { timeoutMsec: TIMEOUTS.defaultRequest, method: 'default' })
        if (!isReportNewSubfeedMessagesResponseData(responseData)) {
            throw Error('Unexpected response to reportNewSubfeedMessages request')
        }
        if (!responseData.success) {
            throw Error(`Error in reportNewSubfeedMessages: ${responseData.errorMessage}`)
        }
    }
    _checkRemove(remoteNodeId: NodeId, feedId: FeedId, subfeedHash: SubfeedHash) {
        const subfeedCode = makeSubscriptionCode(remoteNodeId, feedId, subfeedHash)
        const S = this.#incomingSubscriptions.get(subfeedCode)
        if (!S) return
        const elapsedMsec = S.elapsedMsecSinceLastRenew()
        if (elapsedMsec > durationMsecToNumber(S.durationMsec())) {
            this.#incomingSubscriptions.delete(subfeedCode)
        }
    }
}

const makeSubscriptionCode = (remoteNodeId: NodeId, feedId: FeedId, subfeedHash: SubfeedHash) => {
    return remoteNodeId + ':' + feedId.toString() + ':' + subfeedHash.toString()
}

const makeSubfeedCode = (feedId: FeedId, subfeedHash: SubfeedHash) => {
    return feedId.toString() + ':' + subfeedHash.toString()
}

class IncomingSubfeedSubscription {
    #lastRenewTimestamp = zeroTimestamp()
    constructor(private node: KacheryP2PNode, public remoteNodeId: NodeId, public feedId: FeedId, public subfeedHash: SubfeedHash) {
    }
    renew() {
        this.#lastRenewTimestamp = nowTimestamp()
    }
    durationMsec() {
        return scaledDurationMsec(60 * 1000)
    }
    elapsedMsecSinceLastRenew() {
        return elapsedSince(this.#lastRenewTimestamp)
    }
}

export default NewIncomingSubfeedSubscriptionManager