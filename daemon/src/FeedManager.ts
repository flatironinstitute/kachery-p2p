import os from 'os';
import fs from 'fs';
import { sleepMsec, randomAlphaString } from './common/util';
import { kacheryStorageDir } from './kachery';
import { createKeyPair, publicKeyToHex, privateKeyToHex, getSignatureJson, hexToPublicKey, hexToPrivateKey, sha1sum, JSONStringifyDeterministic, verifySignatureJson, publicKeyHexToFeedId } from './common/crypto_util'
import { assert } from 'console';
import { validateObject, validateSha1Hash, validateNodeId } from './schema/index.js';
import KacheryP2PNode from './KacheryP2PNode';
import { FeedId, feedIdToPublicKeyHex, NodeId, PrivateKey, PrivateKeyHex, PublicKey, PublicKeyHex, SubfeedHash, toStr, SignedSubfeedMessage, FindLiveFeedResult, isSignedSubfeedMessage, nowTimestamp, FeedsConfig, SubfeedAccessRules, isFeedsConfig, isSubfeedAccessRules, SubfeedWatches } from './interfaces';

// todo fix feeds config on disk (too many in one .json file)

class FeedManager {
    // Manages the local feeds and access to the remote feeds in the p2p network
    _node: KacheryP2PNode // The kachery-p2p daemon
    _storageDir: string // Where we store the feed data (subdirector of the kachery storage dir)
    // todo: type
    _feedsConfig: FeedsConfig | null = null // The config will be loaded from disk as need. Contains all the private keys for the feeds and the local name/ID associations.
    // todo: type
    _subfeeds: {[key: string]: Subfeed} = {} // The subfeed instances (Subfeed()) that have been loaded into memory
    _remoteFeedManager: RemoteFeedManager // Manages the interaction with feeds on remote nodes
    constructor(node: KacheryP2PNode) {
        this._node = node;
        this._storageDir = kacheryStorageDir() + '/feeds';
        this._remoteFeedManager = new RemoteFeedManager(this._node);
    }
    async createFeed({ feedName } : {feedName: string | null }) {
        // Create a new writeable feed on this node and return the ID of the new feed

        // Generate the crypto keypair. The publicKey determines the new feed ID
        const {publicKey, privateKey} = createKeyPair();
        const feedId = publicKeyHexToFeedId(publicKeyToHex(publicKey));

        // Load and modify the config (which contains the private keys and associates names to feed IDs)
        const config = await this._loadFeedsConfig();
        config.feeds[toStr(feedId)] = {
            publicKey: publicKeyToHex(publicKey),
            privateKey: privateKeyToHex(privateKey)
        };
        if (feedName)
            config.feedIdsByName[feedName] = feedId;
        await this._saveFeedsConfig(config);

        // Create the feed directory for the actual feed
        await _createFeedDirectoryIfNeeded(feedId);

        // Return the feed ID
        return feedId;
    }
    async deleteFeed({ feedId }: {feedId: FeedId}) {
        validateObject(feedId, '/FeedId');

        const dirPath = _feedDirectory(feedId);
        await fs.promises.rmdir(dirPath, {recursive: true});

        const config = await this._loadFeedsConfig();
        if (toStr(feedId) in config.feeds) {
            delete config.feeds[toStr(feedId)];
        }
        for (let feedName in config.feedIdsByName) {
            if (config.feedIdsByName[feedName] === feedId) {
                delete config.feedIdsByName[feedName]
            }
        }
        await this._saveFeedsConfig(config);
    }
    async getFeedId({ feedName }: { feedName: string }) {
        // assert(typeof(feedName) === 'string');
        // Look up the feed ID for a particular feed name by consulting the config file
        const config = await this._loadFeedsConfig();
        const feedId = config.feedIdsByName[feedName] || null;
        if (feedId) {
            // Return null if we don't actually have the feed directory
            if (!fs.existsSync(_feedDirectory(feedId))) {
                return null;
            }
        }
        return feedId;
    }
    async hasWriteableFeed({ feedId }: { feedId: FeedId }) {
        // Check whether this node has a writeable feed.
        // We do this by ensuring that we have the associated private key and that the feed directory exists
        const privateKey = await this._getPrivateKeyForFeed(feedId);
        if (!privateKey) return;
        // Returns true if we have the writeable feed
        return fs.existsSync(_feedDirectory(feedId));
    }
    async appendMessages(args: { feedId: FeedId, subfeedHash: SubfeedHash, messages: Object[]}) {
        validateObject(args.feedId, '/FeedId');
        validateObject(args.subfeedHash, '/subfeedHash');
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
        if (!subfeed._signedMessages) {
            throw Error(`Unexpected. Loaded subfeed has null _signedMessages`);
        }

        // Append the messages
        subfeed.appendMessages(args.messages, {metaData: undefined});
    }
    async submitMessages(args: { feedId: FeedId, subfeedHash: SubfeedHash, messages: Object[], timeoutMsec: number}) {
        const { feedId, subfeedHash, messages, timeoutMsec } = args;
        validateObject(feedId, '/FeedId');
        validateObject(subfeedHash, '/subfeedHash');
        // assert(Array.isArray(messages));

        // Same as appendMessages, except if we don't have a writeable feed, we submit it to the p2p network
        // and then, on success, it will append the messages on the node where the feed is writeable
        const subfeed = await this._loadSubfeed({feedId, subfeedHash});
        if (subfeed.isWriteable()) {
            // If writeable, let's just append the messages
            await this.appendMessages({feedId, subfeedHash, messages});
            return;
            // throw Error(`Cannot submit messages. Subfeed is writeable: ${feedId} ${subfeedHash}`);
        }
        // Submit the messages to the p2p network
        await this._remoteFeedManager.submitMessages({feedId, subfeedHash, messages, timeoutMsec});
    }
    async appendSignedMessages({ feedId, subfeedHash, signedMessages}: {feedId: FeedId, subfeedHash: SubfeedHash, signedMessages: SignedSubfeedMessage[]}) {
        // Append signed messages to the local version of a feed.
        // This feed does not need to be writeable on this node. If the signatures
        // are correct, then we know that they are valid. These will typically come from a remote node.
        const subfeed = await this._loadSubfeed({feedId, subfeedHash});
        subfeed.appendSignedMessages(signedMessages);
    }
    async getMessages({ feedId, subfeedHash, position, maxNumMessages, waitMsec }: {feedId: FeedId, subfeedHash: SubfeedHash, position: number, maxNumMessages: number, waitMsec: number}) {
        // Load messages from a subfeed.
        // If there are no messages available locally, and waitMsec > 0, then we will search
        // for the messages on the p2p network

        // Get the signed messages
        const signedMessages = await this.getSignedMessages({ feedId, subfeedHash, position, maxNumMessages, waitMsec})

        // Return just the messages (not the signed messages)
        return signedMessages.map(sm => (sm.body.message));
    }
    async getSignedMessages({ feedId, subfeedHash, position, maxNumMessages, waitMsec }: {feedId: FeedId, subfeedHash: SubfeedHash, position: number, maxNumMessages: number, waitMsec: number}) {
        // Same as getMessages() except we return the signed messages. This is also called by getMessages().
        const subfeed = await this._loadSubfeed({feedId, subfeedHash});
        const signedMessages = await subfeed.getSignedMessages({ position, maxNumMessages, waitMsec });
        return signedMessages;
    }
    async getNumMessages({ feedId, subfeedHash }: {feedId: FeedId, subfeedHash: SubfeedHash}) {
        // Get the total number of messages in the local feed only
        // TODO: we may want to optionally do a p2p search, and retrieve the number of messages without retrieving the actual messages
        const subfeed = await this._loadSubfeed({feedId, subfeedHash});
        if (!subfeed) {
            throw Error(`Unable to load subfeed: ${feedId} ${subfeedHash}`);
        }
        return subfeed.getNumMessages();
    }
    async getFeedInfo({ feedId, timeoutMsec }: {feedId: FeedId, timeoutMsec: number}) {
        validateObject(feedId, '/FeedId');
        
        // Get the p2p information about the feed
        // If this is a local and writeable, just return {isWriteable: true}
        // Otherwise we search the p2p network for the feed and if it is found we return {isWriteable: false}
        // Otherwise, if not found, throws an exception
        const privateKey = await this._getPrivateKeyForFeed(feedId);
        if (privateKey) {
            return {
                isWriteable: true
            }
        }
        else {
            // Get the liveFeedInfo. If not found, this will throw an error.
            const liveFeedInfo = await this._remoteFeedManager.findLiveFeedInfo({feedId, timeoutMsec});
            return {
                isWriteable: false,
                liveFeedInfo
            }
        }
    }
    async getAccessRules({ feedId, subfeedHash }: {feedId: FeedId, subfeedHash: SubfeedHash}): Promise<SubfeedAccessRules | null> {
        validateObject(feedId, '/FeedId');
        validateObject(subfeedHash, '/subfeedHash');

        // Get the access rules for a local writeable subfeed
        // These determine which remote nodes have permission to submit messages
        // to this subfeed.
        const subfeed = await this._loadSubfeed({feedId, subfeedHash});
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
        if (!subfeed.isWriteable) {
            throw Error('Cannot set access rules for subfeed that is not writeable')
        }
        await subfeed.setAccessRules(accessRules);
    }
    async watchForNewMessages({ subfeedWatches, waitMsec, maxNumMessages }: {subfeedWatches: SubfeedWatches, waitMsec: number, maxNumMessages: number}) {
        // assert(typeof(waitMsec) === 'number');
        // assert(typeof(waxNumMessages) === 'number');
        return new Promise((resolve, reject) => {
            // Wait until new messages are received on one or more subfeeds, and return information on which watches were triggered

            const watchNames = Object.keys(subfeedWatches);
            let finished = false;

            const messages = {};

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

            watchNames.forEach(watchName => {
                (async () => {
                    const w = subfeedWatches[watchName];
                    const subfeed = await this._loadSubfeed({feedId: w.feedId, subfeedHash: w.subfeedHash});
                    const messages0 = await subfeed.getSignedMessages({position: w.position, maxNumMessages, waitMsec});
                    if (messages0.length > 0) {
                        messages[watchName] = messages0.map(m => m.body.message);
                        numMessages += messages0.length;
                        if (!finished) doFinish();
                    }
                })();
            });

            setTimeout(() => {
                if (!finished) doFinish();
            }, waitMsec);
        });
    }
    async _submitMessagesToLiveFeedFromRemoteNode({fromNodeId, feedId, subfeedHash, messages}: {fromNodeId: NodeId, feedId: FeedId, subfeedHash: SubfeedHash, messages: Object[]}) {
        validateNodeId(fromNodeId);
        validateObject(feedId, '/FeedId');
        validateObject(subfeedHash, '/subfeedHash');
        // assert(Array.isArray(messages));

        // Some messages have been submitted from a remote node
        // Determine whether they can been written, and if so, append them

        // Check whether we have that writeable feed
        if (!(await this.hasWriteableFeed({ feedId }))) {
            throw Error(`Does not have writeable feed: ${feedId}`);
        }

        // Load the subfeed
        const subfeed = await this._loadSubfeed({feedId, subfeedHash});

        // Check whether the sending node has write access to the subfeed
        if (!(await subfeed.remoteNodeHasWriteAccess(fromNodeId))) {
            throw Error(`Write access not allowed for node: ${feedId} ${subfeedHash} ${fromNodeId}`);
        }

        // If so, append the messages. We also provide the sending node ID in the meta data for the messages
        subfeed.appendMessages(messages, {metaData: {submittedByNodeId: fromNodeId}});
    }
    async _loadFeedsConfig(): Promise<FeedsConfig> {
        // Load the configuration for all feeds, if not already loaded
        // This contains all the private keys for the feeds as well as the local name/ID associations for feed

        // Only load if not already in memory
        if (this._feedsConfig) {
            return this._feedsConfig;
        }
        else {
            const configDir = process.env.KACHERY_P2P_CONFIG_DIR || `${os.homedir()}/.kachery-p2p`;
            // todo: validate feedsConfig here
            const x = await readJsonFile(configDir + '/feeds.json', {});
            if (isFeedsConfig(x)) {
                x.feeds = x.feeds || {};
                x.feedIdsByName = x.feedIdsByName || {};
                this._feedsConfig = x;
                return x;
            }
            else {
                throw Error(`Error loading feeds config from: ${configDir}/feeds.json`);
            }
        }
    }
    async _saveFeedsConfig(config: FeedsConfig) {
        // Store the configuration for all feeds
        // This contains all the private keys for the feeds as well as the local name/ID associations for feed

        this._feedsConfig = config;
        const configDir = process.env.KACHERY_P2P_CONFIG_DIR || `${os.homedir()}/.kachery-p2p`;
        await writeJsonFile(configDir + '/feeds.json', this._feedsConfig);
    }
    async _getPrivateKeyForFeed(feedId: FeedId) {
        validateObject(feedId, '/FeedId');
        // Consult the config to get the private key associated with a particular feed ID
        const config = await this._loadFeedsConfig();
        if (toStr(feedId) in config.feeds) {
            return config.feeds[toStr(feedId)].privateKey || null;
        }
        else {
            return null;
        }
    }
    async _loadSubfeed({feedId, subfeedHash}: {feedId: FeedId, subfeedHash: SubfeedHash}) {
        validateObject(feedId, '/FeedId');
        validateObject(subfeedHash, '/subfeedHash');

        // Load a subfeed (Subfeed() instance

        // If we have already loaded it into memory, then do not reload
        const k = feedId + ':' + subfeedHash;
        const subfeed = this._subfeeds[k] || null;

        if (subfeed) {
            await subfeed.waitUntilInitialized();
        }
        else {
            // Instantiate and initialize the subfeed
            const sf = new Subfeed({ node: this._node, remoteFeedManager: this._remoteFeedManager, feedId, subfeedHash });
            // Store in memory for future access (the order is important here, see waitUntilInitialized above)
            this._subfeeds[k] = sf;

            // Load private key if this is writeable (otherwise, privateKey will be null)
            // important to do this after setting this._subfeeds[k], because we need to await it
            const privateKey = await this._getPrivateKeyForFeed(feedId);

            try {
                await sf.initialize(privateKey);
            }
            catch(err) {
                for (let cb of sf._onInitializeErrorCallbacks)
                    cb(err);
                delete this._subfeeds[k];
                throw err;
            }
            for (let cb of sf._onInitializedCallbacks)
                cb();
        }
        
        // Return the subfeed instance
        return this._subfeeds[k];
    }
}

class RemoteFeedManager {
    _node: KacheryP2PNode
    // todo: type
    // todo: fix memory leak
    _liveFeedInfos: {[key: string]: Object; } = {} // Information about the live feeds (cached in memory)
    // Manages interactions with feeds on remote nodes within the p2p network
    constructor(node: KacheryP2PNode) {
        this._node = node; // The kachery-p2p node
    }
    async getSignedMessages({feedId, subfeedHash, position, waitMsec}: {feedId: FeedId, subfeedHash: SubfeedHash, position: number, waitMsec: number}): Promise<SignedSubfeedMessage[] | null> {
        // Get signed messages from a remote feed
        console.info('getSignedMessages', {feedId, subfeedHash, position, waitMsec});

        // Search and find the info for the feed (channel and node id)
        // If not found, return null
        let liveFeedInfo;
        while (true) {
            try {
                liveFeedInfo = await this.findLiveFeedInfo({feedId, timeoutMsec: 0});
                break;
            }
            catch(err) {
                if (waitMsec >= 1000) {
                    // Let's wait a second and try again
                    await sleepMsec(1000);
                    waitMsec -= 1000;   
                }
                else {
                    console.info('Unable to get signed messages (cannot find live feed info)', {feedId});
                    return null;
                }
            }
        }

        // Now that we know the channel and nodeId, we can get the messages from the swarm
        const signedMessages = await this._node.getLiveFeedSignedMessages({
            channelName: liveFeedInfo.channel,
            nodeId: liveFeedInfo.nodeId,
            feedId,
            subfeedHash,
            position,
            waitMsec
        });

        console.info(`Got signed messages.`, {numMessages: signedMessages.length});

        // Return the retrieved messages
        return signedMessages;
    }
    async submitMessages(args: {feedId: FeedId, subfeedHash: SubfeedHash, messages: Object[], timeoutMsec: number}) {
        const {feedId, subfeedHash, messages, timeoutMsec} = args;

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
        await this._node.submitMessagesToLiveFeed({
            channelName: liveFeedInfo.channel,
            nodeId: liveFeedInfo.nodeId,
            feedId,
            subfeedHash,
            messages
        });
    }
    async findLiveFeedInfo({feedId, timeoutMsec}: {feedId: FeedId, timeoutMsec: number}) {
        // Find the channel and nodeId for a feed that is owned by a remote node on the p2p network
        // If not found, throws an error.

        // First check if we have the information in the memory cache
        if (toStr(feedId) in this._liveFeedInfos) {
            return this._liveFeedInfos[toStr(feedId)];
        }
        const asyncHelper = async (): Promise<FindLiveFeedResult> => {
            return new Promise((resolve, reject) => {
                // Find the live feed (this could in theory return multiple results, but ideally it should only return one)
                const x = this._node.findLiveFeed({feedId, timeoutMsec});
                let resolved = false;
                x.onFound(result => {
                    if (resolved) return;
                    validateObject(result, '/FindFileOrLiveFeedResult');

                    // We found it! The result will contain channel and nodeId
                    resolved = true;
                    resolve(result);

                    // Cancel the request because we have what we need
                    x.cancel();
                });
                x.onFinished(() => {
                    if (resolved) return;
                    // I guess we finished without finding anything. Throw an exception
                    reject(Error(`Unable to find live feed info for feed: ${feedId}`));
                })
            });
        }
        const result = await asyncHelper();

        // Store in memory cache
        this._liveFeedInfos[toStr(feedId)] = result;

        // Return the result. The result will contain channel and nodeId.
        return result; 
    }
}

interface SubfeedParams {
    node: KacheryP2PNode,
    remoteFeedManager: RemoteFeedManager,
    feedId: FeedId,
    subfeedHash: SubfeedHash
}

class Subfeed {
    // Represents a subfeed, which may or may not be writeable on this node
    _node : KacheryP2PNode // The kachery-p2p daemon
    _feedId: FeedId // The ID of the feed
    _publicKey: PublicKey // The public key of the feed (which is determined by the feed ID)
    _privateKey: PrivateKeyHex | null // The private key (or null if this is not writeable on the local node) -- set below
    _subfeedHash: SubfeedHash // The hash of the subfeed
    _feedDir: string // The directory of the feed data
    _subfeedDir: string // The directory of the subfeed data
    _subfeedMessagesPath: string // The text file containing the actual messages (JSON strings on lines of text)
    _signedMessages: SignedSubfeedMessage[] | null = null // The signed messages loaded from the messages file (in-memory cache)
    _remoteFeedManager: RemoteFeedManager // The remote feed manager, allowing us to retrieve data from remote nodes
    // todo: type for access rules
    _accessRules: SubfeedAccessRules | null = null // Access rules for this subfeed -- like which nodes on the p2p network have permission to submit messages
    _initialized: boolean = false;
    _initializing: boolean = false;
    _onInitializedCallbacks: (() => void)[] = [];
    _onInitializeErrorCallbacks: ((err: Error) => void)[] = [];
    _newMessageListeners: {[key: string]: (() => void)} = {};

    constructor(params: SubfeedParams) {
        this._node = params.node; // The kachery-p2p daemon
        this._feedId = params.feedId; // The ID of the feed
        this._publicKey = hexToPublicKey(feedIdToPublicKeyHex(this._feedId)); // The public key of the feed (which is determined by the feed ID)
        this._subfeedHash = params.subfeedHash; // The hash of the subfeed
        this._feedDir = _feedDirectory(params.feedId); // The directory of the feed data
        this._subfeedDir = _subfeedDirectory(params.feedId, params.subfeedHash); // The directory of the subfeed data
        this._subfeedMessagesPath = this._subfeedDir + '/messages'; // The text file containing the actual messages (JSON strings on lines of text)
        this._remoteFeedManager = params.remoteFeedManager; // The remote feed manager, allowing us to retrieve data from remote nodes
    }
    async initialize(privateKey: PrivateKeyHex | null) {
        this._privateKey = privateKey;
        if (this._initialized) return;
        if (this._initializing) {
            await this.waitUntilInitialized();
            return;
        }
        this._initializing = true;
        // Check whether we have the feed locally (may or may not be locally writeable)
        const existsLocally = fs.existsSync(_feedDirectory(this._feedId));
        if (existsLocally) {
            // If feed exists. We create the subfeed directory (note: the subfeed directory is nested inside the feed directory)
            await _createSubfeedDirectoryIfNeeded(this._feedId, this._subfeedHash);

            // Read the messages file -- load these into memory
            const messages = await readMessagesFile(this._subfeedMessagesPath);

            // Verify the integrity of the messages

            // The first message has a previousSignature of null
            let previousSignature;
            let previousMessageNumber = -1;
            for (let msg of messages) {
                if (!verifySignatureJson(msg.body, msg.signature, this._publicKey)) {
                    throw Error(`Unable to verify signature of message in feed: ${this._feedDir} ${msg.signature}`)
                }
                if (previousSignature !== (msg.body.previousSignature || null)) {
                    throw Error(`Inconsistent previousSignature of message in feed when reading messages from file: ${this._feedDir} ${previousSignature} ${msg.body.previousSignature}`);
                }
                if (previousMessageNumber + 1 !== msg.body.messageNumber) {
                    throw Error(`Incorrect message number for message in feed when reading messages from file: ${this._feedDir} ${previousMessageNumber + 1} ${msg.body.messageNumber}`);
                }
                previousSignature = msg.signature;
                previousMessageNumber = msg.body.messageNumber;
            }
            // We are good ... load into memory
            this._signedMessages = messages;

            // If this is a writeable feed, we also load the access rules into memory
            if (this.isWriteable()) {
                const accessRules = await readJsonFile(this._subfeedDir + '/access', {rules: []});
                if (isSubfeedAccessRules(accessRules)) {
                    this._accessRules = accessRules;
                }
                else {
                    throw Error(`Invalid access rules in file: ${this._subfeedDir}/access`)
                }
            }
        }
        else {
            // Otherwise, we don't have it locally -- so let's just initialize things
            await _createSubfeedDirectoryIfNeeded(this._feedId, this._subfeedHash);

            this._signedMessages = [];
            this._accessRules = null;

            // Let's try to load messages from remote nodes on the p2p network
            await this.getSignedMessages({position: 0, maxNumMessages: 10, waitMsec: 1});
        }
        this._initializing = false;
        this._initialized = true;

        if (!this._signedMessages) {
            throw Error('Unexpected. signed messages is null at the end of subfeed initialization');
        }
    }
    async waitUntilInitialized() {
        if (this._initialized) return;
        return new Promise((resolve, reject) => {
            this._onInitializeErrorCallbacks.push((err: Error) => {
                reject(err);
            })
            this._onInitializedCallbacks.push(() => {
                resolve();
            });
        });
    }
    getNumMessages(): number {
        // Return the number of messages that are currently loaded into memory
        if (!this._signedMessages) {
            throw Error('_signedMessages is null. Perhaps getNumMessages was called before subfeed was initialized.');
        }
        return this._signedMessages.length;
    }
    isWriteable(): boolean {
        // Whether this subfeed is writeable. That depends on whether we have a private key
        return this._privateKey ? true : false;
    }
    async remoteNodeHasWriteAccess(remoteNodeId: NodeId) {
        // Check whether a remote node has permission to submit messages to this subfeed
        if (!this._accessRules) return false;
        if (!this._accessRules.rules) return false;
        const a = this._accessRules.rules.filter(r => ((r.nodeId === remoteNodeId) && (r.write)));
        return (a.length > 0);
    }
    _getInMemorySignedMessages({position, maxNumMessages}: {position: number, maxNumMessages: number}): SignedSubfeedMessage[] {
        if (!this._signedMessages) {
            throw Error('_signedMessages is null. Perhaps _getInMemorySignedMessages was called before subfeed was initialized.');
        }
        let signedMessages: SignedSubfeedMessage[] = [];
        if (position < this._signedMessages.length) {
            // If we have some messages loaded into memory, let's return those!
            for (let i = position; i < this._signedMessages.length; i++) {
                signedMessages.push(this._signedMessages[i]);
                if (maxNumMessages) {
                    if (signedMessages.length >= maxNumMessages) {
                        break;
                    }
                }
            }
        }
        return signedMessages;
    }
    async getSignedMessages({position, maxNumMessages, waitMsec}: {position: number, maxNumMessages: number, waitMsec: number}): Promise<SignedSubfeedMessage[]> {
        // Get some signed messages starting at position
        if (!this._signedMessages) {
            throw Error('_signedMessages is null. Perhaps getSignedMessages was called before subfeed was initialized.');
        }
        if (position < this._signedMessages.length) {
            // If we have some messages loaded into memory, let's return those!
            return this._getInMemorySignedMessages({position, maxNumMessages});
        }
        else if (position === this._signedMessages.length) {
            // We don't have any new messages in memory
            let signedMessages: SignedSubfeedMessage[] = [];
            if (!this.isWriteable()) {
                // If it's not locally writeable, then we should try to load messages from a remote node
                const remoteSignedMessages = await this._remoteFeedManager.getSignedMessages({
                    feedId: this._feedId,
                    subfeedHash: this._subfeedHash,
                    position: this._signedMessages.length,
                    waitMsec
                });
                if ((remoteSignedMessages) && (remoteSignedMessages.length > 0)) {
                    // We found them! Let's first make sure that our position is still equal to this._signedMessages.length
                    if (position === this._signedMessages.length) {
                        // We found them! So we append them to local feed, and then call getSignedMessages() again. We should then return the appropriate number of signed messages.
                        this.appendSignedMessages(remoteSignedMessages);
                        return this._getInMemorySignedMessages({position, maxNumMessages});
                    }
                    else {
                        if (position < this._signedMessages.length) {
                            // we somehow got more signed messages. So let's go with those!
                            return this._getInMemorySignedMessages({position, maxNumMessages});
                        }
                        else {
                            throw Error('Unexpected problem. Position is now greater than signedMessages.length.')
                        }
                    }
                }
            }
            else if (waitMsec > 0) {
                // If this is a writeable subfeed, and we have been instructed to wait, then let's just wait for a bit and maybe some new messages will arrive.

                await new Promise((resolve) => {
                    let resolved = false;
                    const listenerId = randomAlphaString(10);
                    this._newMessageListeners[listenerId] = () => {
                        if (resolved) return;
                        resolved = true;
                        delete this._newMessageListeners[listenerId];
                        // We have new messages! Call getSignedMessages again to retrieve them.
                        signedMessages = this._getInMemorySignedMessages({position, maxNumMessages});
                        resolve();    
                    }
                    setTimeout(() => {
                        if (resolved) return;
                        resolved = true;
                        delete this._newMessageListeners[listenerId];
                        resolve();
                    }, waitMsec);
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
    appendMessages(messages: Object[], {metaData} : {metaData: Object | undefined}) {
        if (!this._signedMessages) {
            throw Error('_signedMessages is null. Perhaps appendMessages was called before subfeed was initialized.');
        }
        if (!this._privateKey) {
            throw Error(`Cannot write to feed without private key: ${this._privateKey}`);
        }
        let previousSignature;
        if (this._signedMessages.length > 0) {
            previousSignature = this._signedMessages[this._signedMessages.length - 1].signature;
        }
        let messageNumber = this._signedMessages.length;
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
        if (!this._signedMessages) {
            throw Error('_signedMessages is null. Perhaps appendSignedMessages was called before subfeed was initialized.');
        }
        if (signedMessages.length === 0)
            return;
        let previousSignature;
        if (this._signedMessages.length > 0) {
            previousSignature = this._signedMessages[this._signedMessages.length - 1].signature;
        }
        let messageNumber = this._signedMessages.length;
        const textLinesToAppend: string[] = [];
        for (let signedMessage of signedMessages) {
            const body = signedMessage.body;
            const signature = signedMessage.signature;
            if (!verifySignatureJson(body, signature, this._publicKey)) {
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
            this._signedMessages.push(signedMessage);
            textLinesToAppend.push(JSONStringifyDeterministic(signedMessage));
        }
        fs.appendFileSync(this._subfeedMessagesPath, textLinesToAppend.join('\n') + '\n', {encoding: 'utf8'});

        for (let id in this._newMessageListeners) {
            this._newMessageListeners[id]();
        }
    }
    async getAccessRules(): Promise<SubfeedAccessRules | null> {
        return this._accessRules;
    }
    async setAccessRules(accessRules: SubfeedAccessRules) {
        if (!this.isWriteable()) {
            throw Error(`Cannot set access rules for not writeable subfeed.`);
        }
        assert(accessRules.rules, 'Missing rules field');
        await writeJsonFile(this._subfeedDir + '/access', accessRules);
        this._accessRules = accessRules;
    }
}

// todo: type messages
const readMessagesFile = async (path): Promise<SignedSubfeedMessage[]> => {
    let txt: string;
    try {
        txt = await fs.promises.readFile(path, {encoding: 'utf8'});
    }
    catch(err) {
        return [];
    }
    if (typeof(txt) !== 'string') {
        throw Error('Unexpected: txt is not a string.');
    }
    let messages: SignedSubfeedMessage[] = [];
    const lines = txt.split('\n');
    for (let line of lines) {
        if (line) {
            let signedMessage: Object;
            try {
                signedMessage = JSON.parse(line);
            }
            catch(err) {
                console.warn(`Problem parsing JSON from file.`, {path});
                return [];
            }
            if (isSignedSubfeedMessage(signedMessage)) {
                messages.push(signedMessage);
            }
            else {
                console.warn(`Problem with signed message from JSON file.`, {path});
                return [];
            }
            
        }
    }
    return messages;
}

const _createSubfeedDirectoryIfNeeded = async (feedId: FeedId, subfeedHash: SubfeedHash) => {
    const path = _subfeedDirectory(feedId, subfeedHash);
    if (!fs.existsSync(path)) {
        await fs.promises.mkdir(path, {recursive: true});
    }
}

const _createFeedDirectoryIfNeeded = async (feedId: FeedId) => {
    const path = _feedDirectory(feedId);
    if (!fs.existsSync(path)) {
        await fs.promises.mkdir(path, {recursive: true});
    }
    if (!fs.existsSync(path + '/subfeeds')) {
        await fs.promises.mkdir(path + '/subfeeds', {recursive: true});
    }
}

const _feedParentDirectory = (feedId: FeedId): string => {
    return kacheryStorageDir() + `/feeds/${feedId[0]}${feedId[1]}/${feedId[2]}${feedId[3]}/${feedId[4]}${feedId[5]}`;
}

const _feedDirectory = (feedId: FeedId): string => {
    return `${_feedParentDirectory(feedId)}/${feedId}`;
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

const _subfeedDirectory = (feedId: FeedId, subfeedHash: SubfeedHash): string => {
    const feedDir = _feedDirectory(feedId);
    return `${feedDir}/subfeeds/${subfeedHash[0]}${subfeedHash[1]}/${subfeedHash[2]}${subfeedHash[3]}/${subfeedHash[4]}${subfeedHash[5]}/${subfeedHash}`
}

const readJsonFile = async (path: string, defaultVal: Object): Promise<Object> => {
    try {
        const txt = await fs.promises.readFile(path, 'utf-8') as string;
        return JSON.parse(txt);
    }
    catch(err) {
        return defaultVal;
    }
}

const writeJsonFile = async (path: string, obj: Object) => {
    const txt = JSONStringifyDeterministic(obj, 4);
    await fs.promises.writeFile(path, txt);
}

export default FeedManager;