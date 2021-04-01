import { TIMEOUTS } from '../common/constants';
import GarbageMap from '../common/GarbageMap';
import { sleepMsec } from '../common/util';
import { DurationMsec, elapsedSince, FeedId, FindLiveFeedResult, nowTimestamp, scaledDurationMsec, SubfeedHash, SubmittedSubfeedMessage, Timestamp } from '../interfaces/core';
import KacheryP2PNode from '../KacheryP2PNode';
import NewOutgoingSubfeedSubscriptionManager from './NewOutgoingSubfeedSubscriptionManager';

class RemoteFeedManager {
    #liveFeedInfos = new GarbageMap<FeedId, {result: FindLiveFeedResult | null, timestamp: Timestamp}>(scaledDurationMsec(60 * 60 * 1000)) // Information about the live feeds (cached in memory) - null result means not found
    // #remoteSubfeedSubscriptions = new GarbageMap<string, RemoteSubfeedSubscription>(null)
    // Manages interactions with feeds on remote nodes within the p2p network
    constructor(private node: KacheryP2PNode, private outgoingSubfeedSubscriptionManager: NewOutgoingSubfeedSubscriptionManager) {
    }

    async subscribeToRemoteSubfeed(feedId: FeedId, subfeedHash: SubfeedHash): Promise<boolean> {
        // todo: find the node ID and channel of the remote subfeed
        let cachedInfo = this.#liveFeedInfos.get(feedId)
        if (cachedInfo) {
            // invalidate the cached result
            const elapsed = elapsedSince(cachedInfo.timestamp)
            if ((cachedInfo.result) && (elapsed > 1000 * 60 * 10)) {
                cachedInfo = undefined
            }
            else if ((!cachedInfo.result) && (elapsed > 1000 * 30)) {
                cachedInfo = undefined
            }
        }
        if (!cachedInfo) {
            const findLiveFeedResult = await this.node.findLiveFeed({feedId, timeoutMsec: TIMEOUTS.defaultRequest})
            cachedInfo = {result: findLiveFeedResult, timestamp: nowTimestamp()}
            this.#liveFeedInfos.set(feedId, cachedInfo)
        }
        const findLiveFeedResult = cachedInfo.result
        if (!findLiveFeedResult) return false
        const remoteNodeId = findLiveFeedResult.nodeId
        // CHAIN:get_remote_messages:step(5)
        await this.outgoingSubfeedSubscriptionManager.createOrRenewOutgoingSubscription(remoteNodeId, feedId, subfeedHash)
        return true
    }
    async submitMessage(args: {feedId: FeedId, subfeedHash: SubfeedHash, message: SubmittedSubfeedMessage, timeoutMsec: DurationMsec}) {
        const {feedId, subfeedHash, message, timeoutMsec} = args;

        // Submit messages to a subfeed on a remote node
        // This requires write permissions

        // Search and find the info for the feed (channel and nodeId)
        let waitMsec = 2000;
        let liveFeedInfo;
        while (true) {
            try {
                liveFeedInfo = await this.findLiveFeedInfo({feedId, timeoutMsec});
                break;
            }
            catch(err) {
                if (waitMsec >= 2000) {
                    // wait and try again
                    await sleepMsec(scaledDurationMsec(2000));
                    waitMsec -= 2000;
                }
                else {
                    break;
                }
            }
        }

        // If we did not find it, then throw exception
        if (!liveFeedInfo) {
            throw Error(`Cannot find live feed: ${feedId}`);
        }

        // Now that we know the channel and nodeId, we can submit the messages via the swarm
        await this.node.submitMessageToRemoteLiveFeed({
            nodeId: liveFeedInfo.nodeId,
            feedId,
            subfeedHash,
            message,
            timeoutMsec
        });
    }
    async findLiveFeedInfo({feedId, timeoutMsec}: {feedId: FeedId, timeoutMsec: DurationMsec}): Promise<FindLiveFeedResult> {
        // Find the channel and nodeId for a feed that is owned by a remote node on the p2p network
        // If not found, throws an error.

        // First check if we have the information in the memory cache
        const cachedInfo = this.#liveFeedInfos.get(feedId)
        if ((cachedInfo) && (cachedInfo.result)) {
            // check whether the node is still online
            if (this.node.remoteNodeManager().remoteNodeIsOnline(cachedInfo.result.nodeId)) {
                // if so, return it
                return cachedInfo.result
            }
            else {
                // if not, then set the cached info to null
                this.#liveFeedInfos.delete(feedId)
            }
        }

        const x = await this.node.findLiveFeed({feedId, timeoutMsec})
        if (x === null) {
            throw Error('Unable to find live feed.')
        }

        // Store in memory cache
        this.#liveFeedInfos.set(feedId, {result: x, timestamp: nowTimestamp()})
        return x
    }
}

export default RemoteFeedManager