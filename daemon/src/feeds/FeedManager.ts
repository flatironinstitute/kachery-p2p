import GarbageMap from '../common/GarbageMap';
import { sleepMsec } from '../common/util';
import { LocalFeedManagerInterface } from '../external/ExternalInterface';
import { DurationMsec, durationMsecToNumber, FeedId, FeedName, feedSubfeedId, FeedSubfeedId, FindLiveFeedResult, messageCount, MessageCount, NodeId, nowTimestamp, scaledDurationMsec, SignedSubfeedMessage, SubfeedAccessRules, SubfeedHash, SubfeedMessage, subfeedPosition, SubfeedWatch, SubfeedWatchesRAM, SubfeedWatchName, SubmittedSubfeedMessage, submittedSubfeedMessageToSubfeedMessage } from '../interfaces/core';
import KacheryP2PNode from '../KacheryP2PNode';
import NewIncomingSubfeedSubscriptionManager from './NewIncomingSubfeedSubscriptionManager';
import NewOutgoingSubfeedSubscriptionManager from './NewOutgoingSubfeedSubscriptionManager';
import RemoteFeedManager from './RemoteFeedManager';
import Subfeed from './Subfeed';

class FeedManager {
    // Manages the local feeds and access to the remote feeds in the p2p network
    #node: KacheryP2PNode // The kachery-p2p daemon
    #localFeedManager: LocalFeedManagerInterface
    #subfeeds = new GarbageMap<FeedSubfeedId, Subfeed>(scaledDurationMsec(8 * 60 * 1000)) // The subfeed instances (Subfeed()) that have been loaded into memory
    #remoteFeedManager: RemoteFeedManager // Manages the interaction with feeds on remote nodes
    #incomingSubfeedSubscriptionManager: NewIncomingSubfeedSubscriptionManager
    #outgoingSubfeedSubscriptionManager: NewOutgoingSubfeedSubscriptionManager
    constructor(node: KacheryP2PNode, localFeedManager: LocalFeedManagerInterface) {
        this.#node = node
        this.#localFeedManager = localFeedManager
        this.#incomingSubfeedSubscriptionManager = new NewIncomingSubfeedSubscriptionManager(node)
        this.#outgoingSubfeedSubscriptionManager = new NewOutgoingSubfeedSubscriptionManager(node)
        this.#remoteFeedManager = new RemoteFeedManager(this.#node, this.#outgoingSubfeedSubscriptionManager)
    }
    async createFeed({ feedName } : {feedName: FeedName | null }) {
        // Create a new writeable feed on this node and return the ID of the new feed
        return await this.#localFeedManager.createFeed(feedName)
    }
    async deleteFeed({ feedId }: {feedId: FeedId}) {
        await this.#localFeedManager.deleteFeed(feedId)
    }
    async getFeedId({ feedName }: { feedName: FeedName }) {
        return await this.#localFeedManager.getFeedId(feedName)
    }
    async hasWriteableFeed(feedId: FeedId) {
        return await this.#localFeedManager.hasWriteableFeed(feedId)
    }
    async appendMessages(args: { feedId: FeedId, subfeedHash: SubfeedHash, messages: SubfeedMessage[]}) {
        // Append messages to a subfeed (must be in a writeable feed on this node)

        // Load the subfeed and make sure it is writeable
        const subfeed = await this._loadSubfeed(args.feedId, args.subfeedHash);
        if (!subfeed) {
            /* istanbul ignore next */
            throw Error(`Unable to load subfeed: ${args.feedId} ${args.subfeedHash}`);
        }
        if (!subfeed.isWriteable()) {
            throw Error(`Subfeed is not writeable: ${args.feedId} ${args.subfeedHash}`);
        }

        const release = await subfeed.acquireLock()
        try {
            // Append the messages
            // CHAIN:append_messages:step(3)
            await subfeed.appendMessages(args.messages, {metaData: undefined});
        }
        finally {
            release()
        }
    }
    async submitMessage({ feedId, subfeedHash, message, timeoutMsec }: { feedId: FeedId, subfeedHash: SubfeedHash, message: SubmittedSubfeedMessage, timeoutMsec: DurationMsec}) {
        // Same as appendMessages, except if we don't have a writeable feed, we submit it to the p2p network
        // and then, on success, it will append the messages on the node where the feed is writeable
        const subfeed = await this._loadSubfeed(feedId, subfeedHash);
        if (!subfeed) {
            /* istanbul ignore next */
            throw Error(`Unable to load subfeed: ${feedId} ${subfeedHash}`);
        }
        if (subfeed.isWriteable()) {
            // If writeable, let's just append the messages
            await this.appendMessages({feedId, subfeedHash, messages: [submittedSubfeedMessageToSubfeedMessage(message)]})
            return
            // throw Error(`Cannot submit messages. Subfeed is writeable: ${feedId} ${subfeedHash}`);
        }
        // Submit the messages to the p2p network
        await this.#remoteFeedManager.submitMessage({feedId, subfeedHash, message, timeoutMsec});
    }
    async getNumLocalMessages({ feedId, subfeedHash }: {feedId: FeedId, subfeedHash: SubfeedHash}): Promise<MessageCount> {
        // Get the total number of messages in the local feed only
        // future: we may want to optionally do a p2p search, and retrieve the number of messages without retrieving the actual messages
        const subfeed = await this._loadSubfeed(feedId, subfeedHash);
        if (!subfeed) {
            /* istanbul ignore next */
            throw Error(`Unable to load subfeed: ${feedId} ${subfeedHash}`);
        }
        return subfeed.getNumLocalMessages()
    }
    async getFinalLocalMessage({ feedId, subfeedHash } : {feedId: FeedId, subfeedHash: SubfeedHash}): Promise<SubfeedMessage | null> {
        const subfeed = await this._loadSubfeed(feedId, subfeedHash);
        if (!subfeed) {
            return null
        }

        // important to do it this way so we can load new messages into memory (if available)
        const numMessages = Number(subfeed.getNumLocalMessages())
        const position = subfeedPosition(Math.max(0, numMessages - 1))
        const messages = subfeed.getLocalSignedMessages({position, numMessages: messageCount(1)})

        if (messages.length > 0) {
            return messages[messages.length - 1].body.message
        }
        else return null
    }
    async getFeedInfo({ feedId, timeoutMsec }: {feedId: FeedId, timeoutMsec: DurationMsec}): Promise<FindLiveFeedResult> {
        // Get the p2p information about the feed
        // If this is a local and writeable, just return {isWriteable: true}
        // Otherwise we search the p2p network for the feed and if it is found we return {isWriteable: false}
        // Otherwise, if not found, throws an exception
        const privateKey = await this.#localFeedManager.getPrivateKeyForFeed(feedId)
        if (privateKey) {
            return {
                nodeId: this.#node.nodeId()
            }
        }
        else {
            // Get the liveFeedInfo. If not found, this will throw an error.
            const liveFeedInfo = await this.#remoteFeedManager.findLiveFeedInfo({feedId, timeoutMsec});
            return liveFeedInfo;
        }
    }
    async getAccessRules({ feedId, subfeedHash }: {feedId: FeedId, subfeedHash: SubfeedHash}): Promise<SubfeedAccessRules | null> {
        // Get the access rules for a local writeable subfeed
        // These determine which remote nodes have permission to submit messages
        // to this subfeed.
        const subfeed = await this._loadSubfeed(feedId, subfeedHash);
        if (!subfeed) {
            /* istanbul ignore next */
            throw Error(`Unable to load subfeed: ${feedId} ${subfeedHash}`);
        }
        if (!subfeed.isWriteable()) {
            throw Error('Cannot get access rules for subfeed that is not writeable')
        }
        const release = await subfeed.acquireLock()
        let accessRules
        try {
            accessRules = await subfeed.getAccessRules()
        }
        finally {
            release()
        }
        return accessRules
    }
    async setAccessRules({ feedId, subfeedHash, accessRules }: {feedId: FeedId, subfeedHash: SubfeedHash, accessRules: SubfeedAccessRules}) {
        // Set the access rules for a local writeable subfeed
        // These determine which remote nodes have permission to submit messages to this subfeed
        // to this subfeed.
        const subfeed = await this._loadSubfeed(feedId, subfeedHash);
        if (!subfeed) {
            /* istanbul ignore next */
            throw Error(`Unable to load subfeed: ${feedId} ${subfeedHash}`);
        }
        if (!subfeed.isWriteable()) {
            throw Error('Cannot set access rules for subfeed that is not writeable')
        }
        const release = await subfeed.acquireLock()
        try {
            await subfeed.setAccessRules(accessRules)
        }
        finally {
            release()
        }
    }
    async watchForNewMessages({
        subfeedWatches,
        waitMsec,
        maxNumMessages,
        signed
    }: {
        subfeedWatches: SubfeedWatchesRAM,
        waitMsec: DurationMsec,
        maxNumMessages: MessageCount,
        signed: boolean
    }): Promise<Map<SubfeedWatchName, (SubfeedMessage[] | SignedSubfeedMessage[])>> {
        // assert(typeof(waitMsec) === 'number');
        // assert(typeof(waxNumMessages) === 'number');
        return new Promise<Map<SubfeedWatchName, (SubfeedMessage[] | SignedSubfeedMessage[])>>((resolve, reject) => {
            // Wait until new messages are received on one or more subfeeds, and return information on which watches were triggered

            let finished = false;

            const messages = new Map<SubfeedWatchName, SubfeedMessage[] | SignedSubfeedMessage[]>();

            let numMessages = 0;
            const doFinish = async () => {
                if (finished) return;
                if (numMessages > 0) {
                    // maybe we have other messages coming in at exactly the same time. Wait a bit for those
                    await sleepMsec(scaledDurationMsec(30));
                }
                finished = true;
                resolve(messages);
            }

            subfeedWatches.forEach((w: SubfeedWatch, watchName: SubfeedWatchName) => {
                messages.set(watchName, [])
            })
            subfeedWatches.forEach((w: SubfeedWatch, watchName: SubfeedWatchName) => {
                this._loadSubfeed(w.feedId, w.subfeedHash).then((subfeed) => {
                    if (subfeed) {
                        subfeed.waitForSignedMessages({position: w.position, maxNumMessages, waitMsec}).then((messages0) => {
                            if (messages0.length > 0) {
                                if (signed) {
                                    messages.set(watchName, messages0)
                                }
                                else {
                                    messages.set(watchName, messages0.map(m => m.body.message))
                                }
                                numMessages += messages0.length;
                                if (!finished) doFinish();
                            }
                        });
                    }
                })
            })

            setTimeout(() => {
                if (!finished) doFinish();
            }, durationMsecToNumber(waitMsec));
        });
    }
    async renewIncomingSubfeedSubscription(fromNodeId: NodeId, feedId: FeedId, subfeedHash: SubfeedHash): Promise<MessageCount> {
        const subfeed = await this._loadSubfeed(feedId, subfeedHash)
        if (!subfeed.isWriteable()) {
            throw Error('Cannot have an incoming subscription to a subfeed that is not writeable')
        }
        // CHAIN:get_remote_messages:step(11)
        this.#incomingSubfeedSubscriptionManager.createOrRenewIncomingSubscription(fromNodeId, feedId, subfeedHash)
        return subfeed.getNumLocalMessages()
    }
    async reportNumRemoteMessages(remoteNodeId: NodeId, feedId: FeedId, subfeedHash: SubfeedHash, numRemoteMessages: MessageCount) {
        const subfeed = await this._loadSubfeed(feedId, subfeedHash)
        subfeed.reportNumRemoteMessages(remoteNodeId, numRemoteMessages)
    }
    async _loadSubfeed(feedId: FeedId, subfeedHash: SubfeedHash): Promise<Subfeed> {
        const timer = nowTimestamp()
        // Load a subfeed (Subfeed() instance

        // If we have already loaded it into memory, then do not reload
        const k = feedSubfeedId(feedId, subfeedHash)
        let subfeed = this.#subfeeds.get(k) || null

        if (subfeed) {
            await subfeed.waitUntilInitialized()
        }
        else {
            // Instantiate and initialize the subfeed
            subfeed = new Subfeed(this.#node, feedId, subfeedHash, this.#localFeedManager, this.#remoteFeedManager)
            subfeed.onMessagesAdded(() => {
                // CHAIN:append_messages:step(10)
                this.#incomingSubfeedSubscriptionManager.reportMessagesAdded(feedId, subfeedHash, subfeed?.getNumLocalMessages() || messageCount(0))
            })
            // Store in memory for future access (the order is important here, see waitUntilInitialized above)
            this.#subfeeds.set(k, subfeed)

            // Load private key if this is writeable (otherwise, privateKey will be null)
            // important to do this after setting this.#subfeeds(k), because we need to await it
            const privateKey = await this.#localFeedManager.getPrivateKeyForFeed(feedId)

            try {
                await subfeed.initialize(privateKey)
            }
            catch(err) {
                /* istanbul ignore next */
                this.#subfeeds.delete(k)
                /* istanbul ignore next */
                throw err
            }
        }
        
        // Return the subfeed instance
        return subfeed
    }
}

// we use this interface to ensure consistency between the in-memory signed messages and the in-database signed messages (this is crucial for integrity of p2p feed system)


// const _subfeedHash = (subfeedName) => {
//     if (typeof(subfeedName) == 'string') {
//         if (subfeedName.startsWith('~')) {
//             assert(subfeedName.length === 41, `Invalid subfeed name: ${subfeedName}`);
//             validateSha1Hash(subfeedName.slice(1));
//             return subfeedName.slice(1);
//         }
//         return sha1sum(subfeedName);
//     }
//     else {
//         return sha1sum(JSONStringifyDeterministic(subfeedName));
//     }
// }

export default FeedManager;