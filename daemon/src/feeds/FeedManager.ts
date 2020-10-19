import { assert } from 'console';
import { getSignatureJson, hexToPrivateKey, hexToPublicKey, verifySignatureJson } from '../common/crypto_util';
import GarbageMap from '../common/GarbageMap';
import { randomAlphaString, sleepMsec } from '../common/util';
import { LocalFeedManagerInterface } from '../external/ExternalInterface';
import { kacheryStorageDir } from '../external/real/kacheryStorage/kachery';
import { durationMsec, DurationMsec, durationMsecToNumber, FeedId, feedIdToPublicKeyHex, FeedName, feedSubfeedId, FeedSubfeedId, FindLiveFeedResult, isSubfeedAccessRules, JSONObject, NodeId, nowTimestamp, PrivateKeyHex, PublicKey, SignedSubfeedMessage, SubfeedAccessRules, SubfeedHash, SubfeedMessage, SubfeedWatch, SubfeedWatchesRAM, SubfeedWatchName, SubmittedSubfeedMessage, submittedSubfeedMessageToSubfeedMessage } from '../interfaces/core';
import KacheryP2PNode from '../KacheryP2PNode';

// todo fix feeds config on disk (too many in one .json file)

class FeedManager {
    // Manages the local feeds and access to the remote feeds in the p2p network
    _node: KacheryP2PNode // The kachery-p2p daemon
    #localFeedManager: LocalFeedManagerInterface
    _storageDir: string // Where we store the feed data (subdirector of the kachery storage dir)
    _subfeeds = new GarbageMap<FeedSubfeedId, Subfeed>(durationMsec(8 * 60 * 1000)) // The subfeed instances (Subfeed()) that have been loaded into memory
    _remoteFeedManager: RemoteFeedManager // Manages the interaction with feeds on remote nodes
    constructor(node: KacheryP2PNode, localFeedManager: LocalFeedManagerInterface) {
        this._node = node
        this.#localFeedManager = localFeedManager
        this._storageDir = kacheryStorageDir() + '/feeds';
        this._remoteFeedManager = new RemoteFeedManager(this._node);
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
    async hasWriteableFeed({ feedId }: { feedId: FeedId }) {
        return await this.#localFeedManager.hasWriteableFeed(feedId)
    }
    async appendMessages(args: { feedId: FeedId, subfeedHash: SubfeedHash, messages: SubfeedMessage[]}) {
        // assert(Array.isArray(messages));
        // Append messages to a subfeed (must be in a writeable feed on this node)

        // Load the subfeed and make sure it is writeable
        const subfeed = await this._loadSubfeed({feedId: args.feedId, subfeedHash: args.subfeedHash});
        if (!subfeed) {
            throw Error(`Unable to load subfeed: ${args.feedId} ${args.subfeedHash}`);
        }
        if (!subfeed.isWriteable()) {
            throw Error(`Subfeed is not writeable: ${args.feedId} ${args.subfeedHash}`);
        }

        // Append the messages
        subfeed.appendMessages(args.messages, {metaData: undefined});
    }
    async submitMessage({ feedId, subfeedHash, message, timeoutMsec }: { feedId: FeedId, subfeedHash: SubfeedHash, message: SubmittedSubfeedMessage, timeoutMsec: DurationMsec}) {
        // Same as appendMessages, except if we don't have a writeable feed, we submit it to the p2p network
        // and then, on success, it will append the messages on the node where the feed is writeable
        const subfeed = await this._loadSubfeed({feedId, subfeedHash});
        if (!subfeed) {
            throw Error(`Unable to load subfeed: ${feedId} ${subfeedHash}`);
        }
        if (subfeed.isWriteable()) {
            // If writeable, let's just append the messages
            await this.appendMessages({feedId, subfeedHash, messages: [submittedSubfeedMessageToSubfeedMessage(message)]});
            return;
            // throw Error(`Cannot submit messages. Subfeed is writeable: ${feedId} ${subfeedHash}`);
        }
        // Submit the messages to the p2p network
        await this._remoteFeedManager.submitMessage({feedId, subfeedHash, message, timeoutMsec});
    }
    async appendSignedMessages({ feedId, subfeedHash, signedMessages}: {feedId: FeedId, subfeedHash: SubfeedHash, signedMessages: SignedSubfeedMessage[]}) {
        // Append signed messages to the local version of a feed.
        // This feed does not need to be writeable on this node. If the signatures
        // are correct, then we know that they are valid. These will typically come from a remote node.
        const subfeed = await this._loadSubfeed({feedId, subfeedHash});
        if (!subfeed) {
            throw Error(`Unable to load subfeed: ${feedId} ${subfeedHash}`);
        }
        subfeed.appendSignedMessages(signedMessages);
    }
    async getMessages({ feedId, subfeedHash, position, maxNumMessages, waitMsec }: {feedId: FeedId, subfeedHash: SubfeedHash, position: number, maxNumMessages: number, waitMsec: DurationMsec}) {
        // Load messages from a subfeed.
        // If there are no messages available locally, and waitMsec > 0, then we will search
        // for the messages on the p2p network

        // Get the signed messages
        const signedMessages = await this.getSignedMessages({ feedId, subfeedHash, position, maxNumMessages, waitMsec})

        // Return just the messages (not the signed messages)
        return signedMessages.map(sm => (sm.body.message));
    }
    async getSignedMessages({ feedId, subfeedHash, position, maxNumMessages, waitMsec }: {feedId: FeedId, subfeedHash: SubfeedHash, position: number, maxNumMessages: number, waitMsec: DurationMsec}) {
        // Same as getMessages() except we return the signed messages. This is also called by getMessages().
        const subfeed = await this._loadSubfeed({feedId, subfeedHash});
        if (!subfeed) {
            throw Error(`Unable to load subfeed: ${feedId} ${subfeedHash}`);
        }
        const signedMessages = await subfeed.getSignedMessages({ position, maxNumMessages, waitMsec });
        return signedMessages;
    }
    async getNumMessages({ feedId, subfeedHash }: {feedId: FeedId, subfeedHash: SubfeedHash}) {
        // Get the total number of messages in the local feed only
        // future: we may want to optionally do a p2p search, and retrieve the number of messages without retrieving the actual messages
        const subfeed = await this._loadSubfeed({feedId, subfeedHash});
        if (!subfeed) {
            throw Error(`Unable to load subfeed: ${feedId} ${subfeedHash}`);
        }
        return subfeed.getNumMessages();
    }
    async getFeedInfo({ feedId, timeoutMsec }: {feedId: FeedId, timeoutMsec: DurationMsec}): Promise<FindLiveFeedResult> {
        // Get the p2p information about the feed
        // If this is a local and writeable, just return {isWriteable: true}
        // Otherwise we search the p2p network for the feed and if it is found we return {isWriteable: false}
        // Otherwise, if not found, throws an exception
        const privateKey = await this.#localFeedManager.getPrivateKeyForFeed(feedId)
        if (privateKey) {
            return {
                nodeId: this._node.nodeId()
            }
        }
        else {
            // Get the liveFeedInfo. If not found, this will throw an error.
            const liveFeedInfo = await this._remoteFeedManager.findLiveFeedInfo({feedId, timeoutMsec});
            return liveFeedInfo;
        }
    }
    async getAccessRules({ feedId, subfeedHash }: {feedId: FeedId, subfeedHash: SubfeedHash}): Promise<SubfeedAccessRules | null> {
        // Get the access rules for a local writeable subfeed
        // These determine which remote nodes have permission to submit messages
        // to this subfeed.
        const subfeed = await this._loadSubfeed({feedId, subfeedHash});
        if (!subfeed) {
            throw Error(`Unable to load subfeed: ${feedId} ${subfeedHash}`);
        }
        if (!subfeed.isWriteable) {
            throw Error('Cannot get access rules for subfeed that is not writeable')
        }
        return await subfeed.getAccessRules();
    }
    async setAccessRules({ feedId, subfeedHash, accessRules }: {feedId: FeedId, subfeedHash: SubfeedHash, accessRules: SubfeedAccessRules}) {
        // Set the access rules for a local writeable subfeed
        // These determine which remote nodes have permission to submit messages to this subfeed
        // to this subfeed.
        const subfeed = await this._loadSubfeed({feedId, subfeedHash});
        if (!subfeed) {
            throw Error(`Unable to load subfeed: ${feedId} ${subfeedHash}`);
        }
        if (!subfeed.isWriteable) {
            throw Error('Cannot set access rules for subfeed that is not writeable')
        }
        await subfeed.setAccessRules(accessRules);
    }
    async watchForNewMessages({
        subfeedWatches,
        waitMsec,
        maxNumMessages
    }: {
        subfeedWatches: SubfeedWatchesRAM,
        waitMsec: DurationMsec,
        maxNumMessages: number
    }): Promise<Map<SubfeedWatchName, (SubfeedMessage[])>> {
        // assert(typeof(waitMsec) === 'number');
        // assert(typeof(waxNumMessages) === 'number');
        return new Promise((resolve, reject) => {
            // Wait until new messages are received on one or more subfeeds, and return information on which watches were triggered

            let finished = false;

            const messages = new Map<SubfeedWatchName, SubfeedMessage[]>();

            let numMessages = 0;
            const doFinish = async () => {
                if (finished) return;
                if (numMessages > 0) {
                    // maybe we have other messages coming in at exactly the same time. Wait a bit for those
                    await sleepMsec(30);
                }
                finished = true;
                resolve(messages);
            }

            subfeedWatches.forEach((w: SubfeedWatch, watchName: SubfeedWatchName) => {
                (async () => {
                    const subfeed = await this._loadSubfeed({feedId: w.feedId, subfeedHash: w.subfeedHash});
                    if (subfeed) {
                        const messages0 = await subfeed.getSignedMessages({position: w.position, maxNumMessages, waitMsec});
                        if (messages0.length > 0) {
                            messages.set(watchName, messages0.map(m => m.body.message));
                            numMessages += messages0.length;
                            if (!finished) doFinish();
                        }
                    }
                })();
            })

            setTimeout(() => {
                if (!finished) doFinish();
            }, durationMsecToNumber(waitMsec));
        });
    }
    async _submitMessageToLiveFeedFromRemoteNode({fromNodeId, feedId, subfeedHash, message}: {fromNodeId: NodeId, feedId: FeedId, subfeedHash: SubfeedHash, message: SubmittedSubfeedMessage}) {
        // Some messages have been submitted from a remote node
        // Determine whether they can been written, and if so, append them

        // Check whether we have that writeable feed
        if (!(await this.hasWriteableFeed({ feedId }))) {
            throw Error(`Does not have writeable feed: ${feedId}`);
        }

        // Load the subfeed
        const subfeed = await this._loadSubfeed({feedId, subfeedHash});
        if (!subfeed) {
            throw Error(`Unable to load subfeed: ${feedId} ${subfeedHash}`);
        }

        // Check whether the sending node has write access to the subfeed
        if (!(await subfeed.remoteNodeHasWriteAccess(fromNodeId))) {
            throw Error(`Write access not allowed for node: ${feedId} ${subfeedHash} ${fromNodeId}`);
        }

        // If so, append the messages. We also provide the sending node ID in the meta data for the messages
        subfeed.appendMessages([submittedSubfeedMessageToSubfeedMessage(message)], {metaData: {submittedByNodeId: fromNodeId}});
    }
    async _loadSubfeed({feedId, subfeedHash}: {feedId: FeedId, subfeedHash: SubfeedHash}) {
        // Load a subfeed (Subfeed() instance

        // If we have already loaded it into memory, then do not reload
        const k = feedSubfeedId(feedId, subfeedHash);
        const subfeed = this._subfeeds.get(k) || null;

        if (subfeed) {
            await subfeed.waitUntilInitialized();
        }
        else {
            // Instantiate and initialize the subfeed
            const sf = new Subfeed({ node: this._node, remoteFeedManager: this._remoteFeedManager, feedId, subfeedHash, localFeedManager: this.#localFeedManager });
            // Store in memory for future access (the order is important here, see waitUntilInitialized above)
            this._subfeeds.set(k, sf);

            // Load private key if this is writeable (otherwise, privateKey will be null)
            // important to do this after setting this._subfeeds(k), because we need to await it
            const privateKey = await this.#localFeedManager.getPrivateKeyForFeed(feedId);

            try {
                await sf.initialize(privateKey);
            }
            catch(err) {
                this._subfeeds.delete(k);
                throw err;
            }
        }
        
        // Return the subfeed instance
        return this._subfeeds.get(k);
    }
}

class RemoteFeedManager {
    _node: KacheryP2PNode
    _liveFeedInfos = new GarbageMap<FeedId, FindLiveFeedResult>(durationMsec(5 * 60 * 1000)) // Information about the live feeds (cached in memory)
    // Manages interactions with feeds on remote nodes within the p2p network
    constructor(node: KacheryP2PNode) {
        this._node = node; // The kachery-p2p node
    }
    async getSignedMessages({feedId, subfeedHash, position, maxNumMessages, waitMsec}: {feedId: FeedId, subfeedHash: SubfeedHash, position: number, maxNumMessages: number, waitMsec: DurationMsec}): Promise<SignedSubfeedMessage[] | null> {
        // Get signed messages from a remote feed

        let w = durationMsecToNumber(waitMsec)

        // Search and find the info for the feed (channel and node id)
        // If not found, return null
        let liveFeedInfo;
        while (true) {
            try {
                liveFeedInfo = await this.findLiveFeedInfo({feedId, timeoutMsec: durationMsec(0)});
                break;
            }
            catch(err) {
                if (w >= 1000) {
                    // Let's wait a second and try again
                    await sleepMsec(1000);
                    w -= 1000
                }
                else {
                    console.info('Unable to get signed messages (cannot find live feed info)', {feedId});
                    return null;
                }
            }
        }

        // Now that we know the channel and nodeId, we can get the messages from the swarm
        const signedMessages = await this._node.getRemoteLiveFeedSignedMessages({
            nodeId: liveFeedInfo.nodeId,
            feedId,
            subfeedHash,
            position,
            maxNumMessages,
            waitMsec
        });

        console.info(`Got signed messages.`, {numMessages: signedMessages.length});

        // Return the retrieved messages
        return signedMessages;
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
                    await sleepMsec(2000);
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
        await this._node.submitMessageToRemoteLiveFeed({
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
        // todo: avoid a memory leak
        const cachedInfo = this._liveFeedInfos.get(feedId);
        if (cachedInfo) return cachedInfo;

        const x = await this._node.findLiveFeed({feedId, timeoutMsec});
        if (x === null) {
            throw Error('Unable to find live feed.');
        }

        // Store in memory cache
        // todo: avoid memory leak
        this._liveFeedInfos.set(feedId, x);
        return x;
    }
}

interface SubfeedParams {
    node: KacheryP2PNode,
    localFeedManager: LocalFeedManagerInterface,
    remoteFeedManager: RemoteFeedManager,
    feedId: FeedId,
    subfeedHash: SubfeedHash
}

interface ListenerId extends String {
    __listenerId__: never; // phantom
}
const createListenerId = (): ListenerId => {
    return randomAlphaString(10) as any as ListenerId;
}

class Subfeed {
    // Represents a subfeed, which may or may not be writeable on this node
    #localFeedManager: LocalFeedManagerInterface
    _node : KacheryP2PNode // The kachery-p2p daemon
    _feedId: FeedId // The ID of the feed
    _publicKey: PublicKey // The public key of the feed (which is determined by the feed ID)
    _privateKey: PrivateKeyHex | null // The private key (or null if this is not writeable on the local node) -- set below
    _subfeedHash: SubfeedHash // The hash of the subfeed
    _feedDir: string // The directory of the feed data
    _subfeedDir: string // The directory of the subfeed data
    _subfeedMessagesPath: string // The text file containing the actual messages (JSON strings on lines of text)
    #signedMessages: SignedSubfeedMessage[] | null = null // The signed messages loaded from the messages file (in-memory cache)
    #accessRules: SubfeedAccessRules | null = null // Access rules for this subfeed -- like which nodes on the p2p network have permission to submit messages
    #isWriteable: boolean | null = null
    _remoteFeedManager: RemoteFeedManager // The remote feed manager, allowing us to retrieve data from remote nodes
    
    #initialized: boolean = false;
    #initializing: boolean = false;
    
    #onInitializedCallbacks: (() => void)[] = [];
    #onInitializeErrorCallbacks: ((err: Error) => void)[] = [];
    _newMessageListeners = new Map<ListenerId, () => void>();

    constructor(params: SubfeedParams) {
        this._node = params.node; // The kachery-p2p daemon
        this._feedId = params.feedId; // The ID of the feed
        this._publicKey = hexToPublicKey(feedIdToPublicKeyHex(this._feedId)); // The public key of the feed (which is determined by the feed ID)
        this._subfeedHash = params.subfeedHash; // The hash of the subfeed
        this.#localFeedManager = params.localFeedManager
        this._remoteFeedManager = params.remoteFeedManager // The remote feed manager, allowing us to retrieve data from remote nodes
    }
    async initialize(privateKey: PrivateKeyHex | null) {
        this._privateKey = privateKey
        if (this.#initialized) return
        if (this.#initializing) {
            await this.waitUntilInitialized()
            return
        }
        try {
            this.#initializing = true
            // Check whether we have the feed locally (may or may not be locally writeable)
            const existsLocally = this.#localFeedManager.feedExistsLocally(this._feedId)
            if (existsLocally) {
                const messages = await this.#localFeedManager.readSignedSubfeedMessages(this._feedId, this._subfeedHash)

                // Verify the integrity of the messages
                // The first message has a previousSignature of null
                let previousSignature
                let previousMessageNumber = -1
                for (let msg of messages) {
                    if (!verifySignatureJson(msg.body as any as JSONObject, msg.signature, this._publicKey)) {
                        throw Error(`Unable to verify signature of message in feed: ${this._feedDir} ${msg.signature}`)
                    }
                    if (previousSignature !== (msg.body.previousSignature || null)) {
                        throw Error(`Inconsistent previousSignature of message in feed when reading messages from file: ${this._feedDir} ${previousSignature} ${msg.body.previousSignature}`)
                    }
                    if (previousMessageNumber + 1 !== msg.body.messageNumber) {
                        throw Error(`Incorrect message number for message in feed when reading messages from file: ${this._feedDir} ${previousMessageNumber + 1} ${msg.body.messageNumber}`)
                    }
                    previousSignature = msg.signature
                    previousMessageNumber = msg.body.messageNumber
                }

                // store in memory
                this.#signedMessages = messages

                // If this is a writeable feed, we also load the access rules into memory
                this.#isWriteable = await this.#localFeedManager.hasWriteableFeed(this._feedId)
                if (this.#isWriteable) {
                    const accessRules = await this.#localFeedManager.readSubfeedAccessRules(this._feedId, this._subfeedHash)
                    if (isSubfeedAccessRules(accessRules)) {
                        this.#accessRules = accessRules
                    }
                    else {
                        throw Error(`Invalid access rules in file: ${this._subfeedDir}/access`)
                    }
                }
            }
            else {
                this.#isWriteable = false

                // Otherwise, we don't have it locally -- so let's just initialize things
                const messages = await this.#localFeedManager.readSignedSubfeedMessages(this._feedId, this._subfeedHash)
                assert(messages.length === 0)

                this.#signedMessages = messages
                this.#accessRules = null

                // Let's try to load messages from remote nodes on the p2p network
                await this.getSignedMessages({position: 0, maxNumMessages: 10, waitMsec: durationMsec(1)})
            }
        }
        catch(err) {
            this.#onInitializeErrorCallbacks.forEach(cb => {cb(err)})
            throw err
        }

        this.#initializing = false
        this.#initialized = true

        this.#onInitializedCallbacks.forEach(cb => {cb()})
    }
    async waitUntilInitialized() {
        if (this.#initialized) return
        return new Promise((resolve, reject) => {
            this.#onInitializeErrorCallbacks.push((err: Error) => {
                reject(err)
            })
            this.#onInitializedCallbacks.push(() => {
                resolve()
            })
        });
    }
    getNumMessages(): number {
        // Return the number of messages that are currently loaded into memory
        if (this.#signedMessages === null) {
            throw Error('#signedMessages is null. Perhaps getNumMessages was called before subfeed was initialized.');
        }
        return this.#signedMessages.length;
    }
    isWriteable(): boolean {
        // Whether this subfeed is writeable. That depends on whether we have a private key
        if (this.#isWriteable === null) {
            throw Error('#isWriteable is null. Perhaps isWriteable was called before subfeed was initialized.');
        }
        return this.#isWriteable
    }
    async remoteNodeHasWriteAccess(remoteNodeId: NodeId) {
        // Check whether a remote node has permission to submit messages to this subfeed
        if (!this.#accessRules) return false;
        if (!this.#accessRules.rules) return false;
        const a = this.#accessRules.rules.filter(r => ((r.nodeId === remoteNodeId) && (r.write)));
        return (a.length > 0);
    }
    _getInMemorySignedMessages({position, maxNumMessages}: {position: number, maxNumMessages: number}): SignedSubfeedMessage[] {
        if (!this.#signedMessages) {
            throw Error('_signedMessages is null. Perhaps _getInMemorySignedMessages was called before subfeed was initialized.');
        }
        let signedMessages: SignedSubfeedMessage[] = [];
        if (position < this.#signedMessages.length) {
            // If we have some messages loaded into memory, let's return those!
            for (let i = position; i < this.#signedMessages.length; i++) {
                signedMessages.push(this.#signedMessages[i]);
                if (maxNumMessages) {
                    if (signedMessages.length >= maxNumMessages) {
                        break;
                    }
                }
            }
        }
        return signedMessages;
    }
    async getSignedMessages({position, maxNumMessages, waitMsec}: {position: number, maxNumMessages: number, waitMsec: DurationMsec}): Promise<SignedSubfeedMessage[]> {
        // Get some signed messages starting at position
        if (!this.#signedMessages) {
            throw Error('_signedMessages is null. Perhaps getSignedMessages was called before subfeed was initialized.');
        }
        if (position < this.#signedMessages.length) {
            // If we have some messages loaded into memory, let's return those!
            return this._getInMemorySignedMessages({position, maxNumMessages});
        }
        else if (position === this.#signedMessages.length) {
            // We don't have any new messages in memory
            let signedMessages: SignedSubfeedMessage[] = [];
            if (!this.isWriteable()) {
                // If it's not locally writeable, then we should try to load messages from a remote node
                const remoteSignedMessages = await this._remoteFeedManager.getSignedMessages({
                    feedId: this._feedId,
                    subfeedHash: this._subfeedHash,
                    position: this.#signedMessages.length,
                    maxNumMessages,
                    waitMsec
                });
                if ((remoteSignedMessages) && (remoteSignedMessages.length > 0)) {
                    // We found them! Let's first make sure that our position is still equal to this._signedMessages.length
                    if (position === this.#signedMessages.length) {
                        // We found them! So we append them to local feed, and then call getSignedMessages() again. We should then return the appropriate number of signed messages.
                        this.appendSignedMessages(remoteSignedMessages);
                        return this._getInMemorySignedMessages({position, maxNumMessages});
                    }
                    else {
                        if (position < this.#signedMessages.length) {
                            // we somehow got more signed messages. So let's go with those!
                            return this._getInMemorySignedMessages({position, maxNumMessages});
                        }
                        else {
                            throw Error('Unexpected problem. Position is now greater than signedMessages.length.')
                        }
                    }
                }
            }
            else if (durationMsecToNumber(waitMsec) > 0) {
                // If this is a writeable subfeed, and we have been instructed to wait, then let's just wait for a bit and maybe some new messages will arrive.

                await new Promise((resolve) => {
                    let resolved = false;
                    const listenerId = createListenerId();
                    this._newMessageListeners.set(listenerId, () => {
                        if (resolved) return;
                        resolved = true;
                        this._newMessageListeners.delete(listenerId);
                        // We have new messages! Call getSignedMessages again to retrieve them.
                        signedMessages = this._getInMemorySignedMessages({position, maxNumMessages});
                        resolve();    
                    });
                    setTimeout(() => {
                        if (resolved) return;
                        resolved = true;
                        this._newMessageListeners.delete(listenerId);
                        resolve();
                    }, durationMsecToNumber(waitMsec));
                });
                
                // const timer = new Date();
                // while (true) {
                //     // todo: use callback strategy instead (call directly from appendSignedMessages)
                //     await sleepMsec(100);
                //     if (position < this._signedMessages.length) {
                //         // We have new messages! Call getSignedMessages again to retrieve them.
                //         return this._getInMemorySignedMessages({position, maxNumMessages});
                //     }
                //     const elapsed = (new Date()) - timer;
                //     if (elapsed > waitMsec) {
                //         break;
                //     }
                // }
            }
            // Finally, return the signed messages that have been accumulated above.
            return signedMessages;
        }
        else {
            return [];
        }
    }
    // important that this is synchronous
    appendMessages(messages: SubfeedMessage[], {metaData} : {metaData: Object | undefined}) {
        if (!this.#signedMessages) {
            throw Error('_signedMessages is null. Perhaps appendMessages was called before subfeed was initialized.');
        }
        if (!this._privateKey) {
            throw Error(`Cannot write to feed without private key: ${this._privateKey}`);
        }
        let previousSignature;
        if (this.#signedMessages.length > 0) {
            previousSignature = this.#signedMessages[this.#signedMessages.length - 1].signature;
        }
        let messageNumber = this.#signedMessages.length;
        const signedMessages: SignedSubfeedMessage[] = [];
        for (let msg of messages) {
            let body = {
                message: msg,
                previousSignature,
                messageNumber,
                timestamp: nowTimestamp(),
                metaData: metaData ? metaData : undefined
            };
            const signedMessage: SignedSubfeedMessage = {
                body,
                signature: getSignatureJson(body, {publicKey: this._publicKey, privateKey: hexToPrivateKey(this._privateKey)})
            };
            signedMessages.push(signedMessage);
            previousSignature = signedMessage.signature;
            messageNumber ++;
        }
        this.appendSignedMessages(signedMessages);
    }
    // important that this is synchronous!
    appendSignedMessages(signedMessages: SignedSubfeedMessage[]) {
        if (!this.#signedMessages) {
            throw Error('_signedMessages is null. Perhaps appendSignedMessages was called before subfeed was initialized.');
        }
        if (signedMessages.length === 0)
            return;
        let previousSignature;
        if (this.#signedMessages.length > 0) {
            previousSignature = this.#signedMessages[this.#signedMessages.length - 1].signature;
        }
        let messageNumber = this.#signedMessages.length;
        const signedMessagesToAppend: SignedSubfeedMessage[] = []
        for (let signedMessage of signedMessages) {
            const body = signedMessage.body;
            const signature = signedMessage.signature;
            if (!verifySignatureJson(body as any as JSONObject, signature, this._publicKey)) {
                throw Error(`Error verifying signature when appending signed message for: ${this._feedId} ${this._subfeedHash} ${signature}`);
            }
            if ((body.previousSignature || null) !== (previousSignature || null)) {
                throw Error(`Error in previousSignature when appending signed message for: ${this._feedId} ${this._subfeedHash} ${body.previousSignature} <> ${previousSignature}`);
            }
            if (body.messageNumber !== messageNumber) {
                throw Error(`Error in messageNumber when appending signed message for: ${this._feedId} ${this._subfeedHash} ${body.messageNumber} <> ${messageNumber}`);
            }
            previousSignature = signedMessage.signature;
            messageNumber ++;
            this.#signedMessages.push(signedMessage);
            signedMessagesToAppend.push(signedMessage)
        }
        this.#localFeedManager.appendSignedMessagesToSubfeed(this._feedId, this._subfeedHash, signedMessagesToAppend)

        this._newMessageListeners.forEach((listener) => {
            listener()
        })
    }
    async getAccessRules(): Promise<SubfeedAccessRules | null> {
        return this.#accessRules
    }
    async setAccessRules(accessRules: SubfeedAccessRules) {
        if (!this.isWriteable()) {
            throw Error(`Cannot set access rules for not writeable subfeed.`);
        }
        await this.#localFeedManager.setSubfeedAccessRules(this._feedId, this._subfeedHash, accessRules)
        this.#accessRules = accessRules
    }
}

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