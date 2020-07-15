import os from 'os';
import fs from 'fs';
import { sleepMsec } from './util.js';
import { kacheryStorageDir } from './kachery.js';
import { createKeyPair, publicKeyToHex, privateKeyToHex, verifySignature, getSignature, hexToPublicKey, hexToPrivateKey, sha1sum } from './crypto_util.js'

class FeedManager {
    // Manages the local feeds and access to the remote feeds in the p2p network

    constructor(daemon, {verbose}) {
        this._daemon = daemon; // The kachery-p2p daemon
        this._storageDir = kacheryStorageDir() + '/feeds'; // Where we store the feed data (subdir of the kachery storage dir)
        this._feedsConfig = null; // The config will be loaded from disk as need. Contains all the private keys for the feeds and the local name/ID associations.
        this._subfeeds = {}; // The subfeed instances (Subfeed()) that have been loaded into memory
        this._verbose = verbose;
        this._remoteFeedManager = new RemoteFeedManager(this._daemon, {verbose: this._verbose}); // Manages the interaction with feeds on remote nodes
    }
    async createFeed({ feedName }) {
        // Create a new writeable feed on this node and return the ID of the new feed

        // Generate the crypto keypair. The publicKey determines the new feed ID
        const {publicKey, privateKey} = createKeyPair();
        const feedId = publicKeyToHex(publicKey);

        // Load and modify the config (which contains the private keys and associates names to feed IDs)
        const config = await this._loadFeedsConfig();
        config['feeds'][feedId] = {
            publicKey: publicKeyToHex(publicKey),
            privateKey: privateKeyToHex(privateKey)
        };
        if (feedName)
            config['feedIdsByName'][feedName] = feedId;
        await this._saveFeedsConfig(config);

        // Create the feed directory for the actual feed
        await _createFeedDirectoryIfNeeded(feedId);

        // Return the feed ID
        return feedId;
    }
    async getFeedId({ feedName }) {
        // Look up the feed ID for a particular feed name by consulting the config file
        const config = await this._loadFeedsConfig();
        const feedId = config['feedIdsByName'][feedName] || null;
        if (feedId) {
            // Return null if we don't actually have the feed directory
            if (!fs.existsSync(_feedDirectory(feedId))) {
                return null;
            }
        }
        return feedId;
    }
    async hasWriteableFeed({ feedId }) {
        // Check whether this node has a writeable feed.
        // We do this by ensuring that we have the associated private key and that the feed directory exists
        const privateKey = this._getPrivateKeyForFeed(feedId);
        if (!privateKey) return;
        // Returns true if we have the writeable feed
        return fs.existsSync(_feedDirectory(feedId));
    }
    async appendMessages({ feedId, subfeedName, messages}) {
        // Append messages to a subfeed (must be in a writeable feed on this node)

        // Load the subfeed and make sure it is writeable
        const subfeed = await this._loadSubfeed({feedId, subfeedName});
        if (!subfeed.isWriteable()) {
            throw Error(`Subfeed is not writeable: ${feedId} ${subfeedName}`);
        }

        // Append the messages
        subfeed.appendMessages(messages);
    }
    async submitMessages({ feedId, subfeedName, messages}) {
        // Same as appendMessages, except if we don't have a writeable feed, we submit it to the p2p network
        // and then, on success, it will append the messages on the node where the feed is writeable
        const subfeed = await this._loadSubfeed({feedId, subfeedName});
        if (subfeed.isWriteable()) {
            // If writeable, let's just append the messages
            await this.appendMessages({feedId, subfeedName, messages});
            return;
            // throw Error(`Cannot submit messages. Subfeed is writeable: ${feedId} ${subfeedName}`);
        }
        // Submit the messages to the p2p network
        await this._remoteFeedManager.submitMessages({feedId, subfeedName, messages});
    }
    async appendSignedMessages({ feedId, subfeedName, signedMessages}) {
        // Append signed messages to the local version of a feed.
        // This feed does not need to be writeable on this node. If the signatures
        // are correct, then we know that they are valid. These will typically come from a remote node.
        const subfeed = await this._loadSubfeed({feedId, subfeedName});
        subfeed.appendSignedMessages(signedMessages);
    }
    async getMessages({ feedId, subfeedName, position, maxNumMessages, waitMsec }) {
        // Load messages from a subfeed.
        // If there are no messages available locally, and waitMsec > 0, then we will search
        // for the messages on the p2p network

        // Get the signed messages
        const signedMessages = await this.getSignedMessages({ feedId, subfeedName, position, maxNumMessages, waitMsec})

        // Return just the messages (not the signed messages)
        return signedMessages.map(sm => (sm.body.message));
    }
    async getSignedMessages({ feedId, subfeedName, position, maxNumMessages, waitMsec }) {
        // Same as getMessages() except we return the signed messages. This is also called by getMessages().
        const subfeed = await this._loadSubfeed({feedId, subfeedName});
        const signedMessages = await subfeed.getSignedMessages({ position, maxNumMessages, waitMsec });
        return signedMessages;
    }
    async getNumMessages({ feedId, subfeedName }) {
        // Get the total number of messages in the local feed only
        // TODO: we may want to optionally do a p2p search, and retrieve the number of messages without retrieving the actual messages
        const subfeed = await this._loadSubfeed({feedId, subfeedName});
        if (!subfeed) {
            throw Error(`Unable to load subfeed: ${feedId} ${subfeedName}`);
        }
        return subfeed.getNumMessages();
    }
    async getFeedInfo({ feedId }) {
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
            const liveFeedInfo = await this._remoteFeedManager.findLiveFeedInfo({feedId});
            return {
                isWriteable: false,
                liveFeedInfo
            }
        }
    }
    async getAccessRules({ feedId, subfeedName }) {
        // Get the access rules for a local writeable subfeed
        // These determine which remote nodes have permission to submit messages
        // to this subfeed.
        const subfeed = await this._loadSubfeed({feedId, subfeedName});
        if (!subfeed.isWriteable) {
            throw Error('Cannot get access rules for subfeed that is not writeable')
        }
        return await subfeed.getAccessRules();
    }
    async setAccessRules({ feedId, subfeedName, rules }) {
        // Set the access rules for a local writeable subfeed
        // These determine which remote nodes have permission to submit messages to this subfeed
        // to this subfeed.
        const subfeed = await this._loadSubfeed({feedId, subfeedName});
        if (!subfeed.isWriteable) {
            throw Error('Cannot set access rules for subfeed that is not writeable')
        }
        await subfeed.setAccessRules(rules);
    }
    async watchForNewMessages({ subfeedWatches, waitMsec, maxNumMessages=0 }) {
        return new Promise((resolve, reject) => {
            // Wait until new messages are received on one or more subfeeds, and return information on which watches were triggered

            const watchNames = Object.keys(subfeedWatches);
            let finished = false;

            const messages = {};

            const doFinish = async () => {
                if (finished) return;
                finished = true;
                // in case we have other messages coming in at the same time
                // TODO: only do this if we have results that have not come in yet
                await sleepMsec(30);
                resolve(messages);
            }

            watchNames.forEach(watchName => {
                (async () => {
                    const w = subfeedWatches[watchName];
                    const subfeed = await this._loadSubfeed({feedId: w.feedId, subfeedName: w.subfeedName});
                    const messages0 = await subfeed.getSignedMessages({position: w.position, maxNumMessages, waitMsec});
                    if (messages0.length > 0) {
                        messages[watchName] = messages0.map(m => m.body.message);
                        if (!finished) doFinish();
                    }
                })();
            });

            setTimeout(() => {
                if (!finished) doFinish();
            }, waitMsec);
        });
    }
    async _submitMessagesToLiveFeedFromRemoteNode({fromNodeId, feedId, subfeedName, messages}) {
        // Some messages have been submitted from a remote node
        // Determine whether they can been written, and if so, append them

        // Check whether we have that writeable feed
        if (!(await this.hasWriteableFeed({ feedId }))) {
            throw Error(`Does not have writeable feed: ${feedId}`);
        }

        // Load the subfeed
        const subfeed = await this._loadSubfeed({feedId, subfeedName});

        // Check whether the sending node has write access to the subfeed
        if (!(await subfeed.remoteNodeHasWriteAccess(fromNodeId))) {
            throw Error(`Write access not allowed for node: ${feedId} ${subfeedName} ${fromNodeId}`);
        }

        // If so, append the messages. We also provide the sending node ID in the meta data for the messages
        subfeed.appendMessages(messages, {metaData: {submittedByNodeId: fromNodeId}});
    }
    async _loadFeedsConfig() {
        // Load the configuration for all feeds, if not already loaded
        // This contains all the private keys for the feeds as well as the local name/ID associations for feed

        // Only load if not already in memory
        if (!this._feedsConfig) {
            const configDir = process.env.KACHERY_P2P_CONFIG_DIR || `${os.homedir()}/.kachery-p2p`;
            const x = await readJsonFile(configDir + '/feeds.json', {});
            x.feeds = x.feeds || {};
            x.feedIdsByName = x.feedIdsByName || {};
            this._feedsConfig = x;
        }
        return this._feedsConfig;
    }
    async _saveFeedsConfig(config) {
        // Store the configuration for all feeds
        // This contains all the private keys for the feeds as well as the local name/ID associations for feed

        this._feedsConfig = config;
        const configDir = process.env.KACHERY_P2P_CONFIG_DIR || `${os.homedir()}/.kachery-p2p`;
        await writeJsonFile(configDir + '/feeds.json', this._feedsConfig);
    }
    async _getPrivateKeyForFeed(feedId) {
        // Consult the config to get the private key associated with a particular feed ID
        const config = await this._loadFeedsConfig();
        if (feedId in config.feeds) {
            return config.feeds[feedId].privateKey || null;
        }
        else {
            return null;
        }
    }
    async _loadSubfeed({feedId, subfeedName}) {
        // Load a subfeed (Subfeed() instance

        // If we have already loaded it into memory, the do not reload
        const k = feedId + ':' + _subfeedHash(subfeedName);
        const subfeed = this._subfeeds[k] || null;
        if (subfeed) {
            await subfeed.waitUntilInitialized();
        }
        else {
            // Load private key if this is writeable (otherwise, privateKey will be null)
            const privateKey = await this._getPrivateKeyForFeed(feedId);

            // Instantiate and initialize the subfeed
            const sf = new Subfeed({ daemon: this._daemon, remoteFeedManager: this._remoteFeedManager, feedId, subfeedName, privateKey });
            // Store in memory for future access
            this._subfeeds[k] = sf;
            await sf.initialize();
        }
        
        // Return the subfeed instance
        return this._subfeeds[k];
    }
}

class RemoteFeedManager {
    // Manages interactions with feeds on remote nodes within the p2p network
    constructor(daemon, {verbose}) {
        this._daemon = daemon; // The kachery-p2p daemon
        this._liveFeedInfos = {}; // Information about the live feeds (cached in memory)
        this._verbose = verbose;
    }
    async getSignedMessages({feedId, subfeedName, position, waitMsec}) {
        // Get signed messages from a remote feed
        if (this._verbose >= 200) {
            console.log('getSignedMessages', feedId, subfeedName, position, waitMsec);
        }

        // Search and find the info for the feed (swarmName and primaryNodeId)
        // If not found, return null
        let liveFeedInfo = null;
        while (true) {
            try {
                liveFeedInfo = await this.findLiveFeedInfo({feedId});
                break;
            }
            catch(err) {
                if (waitMsec >= 1000) {
                    // Let's wait a second and try again
                    await sleepMsec(1000);
                    waitMsec -= 1000;   
                }
                else {
                    if (this._verbose >= 200) {
                        console.info('Unable to get signed messages (cannot find live feed info)');
                    }
                    return null;
                }
            }
        }

        // Now that we know the swarmName and primaryNodeId, we can get the messages from the data transfer swarm
        const signedMessages = await this._daemon._getLiveFeedSignedMessages({
            primaryNodeId: liveFeedInfo.primaryNodeId,
            swarmName: liveFeedInfo.swarmName,
            feedId,
            subfeedName,
            position,
            waitMsec,
            opts: {}
        });

        if (this._verbose >= 200) {
            console.info(`Got ${signedMessages.length} signed messages.`);
        }

        // Return the retrieved messages
        return signedMessages;
    }
    async submitMessages({feedId, subfeedName, messages}) {
        // Submit messages to a subfeed on a remote node
        // This requires write permissions

        // Search and find the info for the feed (swarmName and primaryNodeId)
        let waitMsec = 2000;
        let liveFeedInfo = null;
        while (true) {
            try {
                liveFeedInfo = await this.findLiveFeedInfo({feedId});
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

        // Now that we know the swarmName and primaryNodeId, we can submit the messages to the data transfer swarm
        await this._daemon._submitMessagesToLiveFeed({
            primaryNodeId: liveFeedInfo.primaryNodeId,
            swarmName: liveFeedInfo.swarmName,
            feedId,
            subfeedName,
            messages
        });
    }
    async findLiveFeedInfo({feedId}) {
        // Find the swarmName and primaryNodeId for a feed that is owned by a remote node on the p2p network
        // If not found, throws an error.

        // First check if we have the information in the memory cache
        if (feedId in this._liveFeedInfos) {
            return this._liveFeedInfos[feedId];
        }
        const asyncHelper = async () => {
            return new Promise((resolve, reject) => {
                // Find the live feed (this could in theory return multiple results, but ideally it should only return one)
                const x = this._daemon.findLiveFeed({feedId});
                let resolved = false;
                x.onFound(result => {
                    if (resolved) return;

                    // We found it! The result will contain swarmName and primaryNodeId.
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
        this._liveFeedInfos[feedId] = result;

        // Return the result. The result will contain swarmName and primaryNodeId.
        return result; 
    }
}

class Subfeed {
    // Represents a subfeed, which may or may not be writeable on this node

    constructor({ daemon, remoteFeedManager, feedId, subfeedName, privateKey }) {
        this._daemon = daemon; // The kachery-p2p daemon
        this._feedId = feedId; // The ID of the feed
        this._publicKey = hexToPublicKey(this._feedId); // The public key of the feed (which is determined by the feed ID)
        this._privateKey = privateKey; // The private key (or null if this is not writeable on the local node)
        this._subfeedName = subfeedName; // The name of the subfeed
        this._feedDir = _feedDirectory(feedId); // The directory of the feed data
        this._subfeedDir = _subfeedDirectory(feedId, subfeedName); // The directory of the subfeed data
        this._subfeedMessagesPath = this._subfeedDir + '/messages'; // The text file containing the actual messages (JSON strings on lines of text)
        this._signedMessages = null; // The signed messages loaded from the messages file (in-memory cache)
        this._remoteFeedManager = remoteFeedManager; // The remote feed manager, allowing us to retrieve data from remote nodes
        this._accessRules = null; // Access rules for this subfeed -- like which nodes on the p2p network have permission to submit messages
        this._initialized = false;
        this._initializing = false;
        this._onInitializedCallbacks = [];
    }
    async initialize() {
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
            await _createSubfeedDirectoryIfNeeded(this._feedId, this._subfeedName);

            // Read the messages file -- load these into memory
            const messages = await readMessagesFile(this._subfeedMessagesPath);

            // Verify the integrity of the messages

            // The first message has a previousSignature of null
            let previousSignature = null;
            let previousMessageNumber = -1;
            for (let msg of messages) {
                if (!verifySignature(msg.body, msg.signature, this._publicKey)) {
                    console.warn(msg.body);
                    console.warn(msg.signature);
                    console.warn(this._publicKey);
                    throw Error(`Unable to verify signature of message in feed: ${this._feedDir} ${msg.signature}`)
                }
                if (previousSignature !== (msg.body.previousSignature || null)) {
                    throw Error(`Inconsistent previousSignature of message in feed when reading messages from file: ${this._feedDir} ${previousSignature} ${msg.body.previousSignature}`);
                }
                if (previousMessageNumber + 1 !== msg.body.messageNumber) {
                    throw Error(`Incorrect message number for message in feed when reading messages from file: ${this._feedDir} ${previousMessageNumber + 1} ${msg.body.previousMessageNumber}`);
                }
                previousSignature = msg.signature;
                previousMessageNumber = msg.body.messageNumber;
            }
            // We are good ... load into memory
            this._signedMessages = messages;

            // If this is a writeable feed, we also load the access rules into memory
            if (this.isWriteable()) {
                this._accessRules = await readJsonFile(this._subfeedDir + '/access', {rules: []});
            }
        }
        else {
            // Otherwise, we don't have it locally -- so let's just initialize things
            await _createSubfeedDirectoryIfNeeded(this._feedId, this._subfeedName);

            this._signedMessages = [];
            this._accessRules = null;

            // Let's try to load messages from remote nodes on the p2p network
            await this.getSignedMessages({position: 0, maxNumMessages: 10, waitMsec: 0});
        }
        this._initializing = false;
        this._initialized = true;
        for (let cb of this._onInitializedCallbacks)
            cb();
    }
    async waitUntilInitialized() {
        if (this._initialized) return;
        return new Promise((resolve, reject) => {
            this._onInitializedCallbacks.push(() => {
                resolve();
            });
        });
    }
    getNumMessages() {
        // Return the number of messages that are currently loaded into memory
        return this._signedMessages.length;
    }
    isWriteable() {
        // Whether this subfeed is writeable. That depends on whether we have a private key
        return this._privateKey ? true : false;
    }
    async remoteNodeHasWriteAccess(remoteNodeId) {
        // Check whether a remote node has permission to submit messages to this subfeed
        if (!this._accessRules) return false;
        if (!this._accessRules.rules) return false;
        const a = this._accessRules.rules.filter(r => ((r.nodeId === remoteNodeId) && (r.write)));
        return (a.length > 0);
    }
    async getSignedMessages({position, maxNumMessages, waitMsec=null}) {
        // Get some signed messages starting at position
        const signedMessages = [];
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
        else if (position === this._signedMessages.length) {
            // We don't have any new messages in memory
            if (!this.isWriteable()) {
                // If it's not locally writeable, then we should try to load messages from a remote node
                const remoteSignedMessages = await this._remoteFeedManager.getSignedMessages({
                    feedId: this._feedId,
                    subfeedName: this._subfeedName,
                    position: this._signedMessages.length,
                    waitMsec
                });
                if ((remoteSignedMessages) && (remoteSignedMessages.length > 0)) {
                    // We found them! Let's first make sure that our position is still equal to this._signedMessages.length
                    if (position === this._signedMessages.length) {
                        // We found them! So we append them to local feed, and then call getSignedMessages() again. We should then return the appropriate number of signed messages.
                        this.appendSignedMessages(remoteSignedMessages);
                        return this.getSignedMessages({position, maxNumMessages});
                    }
                    else {
                        if (position < this._signedMessages.length) {
                            // we somehow got more signed messages. So let's go with those!
                            return this.getSignedMessages({position, maxNumMessages});
                        }
                        else {
                            throw Error('Unexpected problem. Position is now greater than signedMessages.length.')
                        }
                    }
                }
            }
            else if ((waitMsec) && (waitMsec > 0)) {
                // If this is a writeable subfeed, and we have been instructed to wait, then let's just wait for a bit and maybe some new messages will arrive.

                const timer = new Date();
                while (true) {
                    // todo: use callback strategy instead (call directly from appendSignedMessages)
                    await sleepMsec(100);
                    if (position < this._signedMessages.length) {
                        // We have new messages! Call getSignedMessages again to retrieve them.
                        return this.getSignedMessages({position, maxNumMessages});
                    }
                    const elapsed = (new Date()) - timer;
                    if (elapsed > waitMsec) {
                        break;
                    }
                }
            }
        }
        // Finally, return the signed messages that have been accumulated above.
        return signedMessages;
    }
    // important that this is synchronous
    appendMessages(messages, opts) {
        opts = opts || {};
        if (!this._privateKey) {
            throw Error(`Cannot write to feed without private key: ${this._privateKey}`);
        }
        let previousSignature = null;
        if (this._signedMessages.length > 0) {
            previousSignature = this._signedMessages[this._signedMessages.length - 1].signature;
        }
        let messageNumber = this._signedMessages.length;
        const signedMessages = [];
        for (let msg of messages) {
            let body = {
                message: msg,
                previousSignature,
                messageNumber
            };
            if (opts.metaData) {
                body.metaData = opts.metaData;
            }
            const signedMessage = {
                body,
                signature: getSignature(body, {publicKey: this._publicKey, privateKey: hexToPrivateKey(this._privateKey)})
            };
            signedMessages.push(signedMessage);
            previousSignature = signedMessage.signature;
            messageNumber ++;
        }
        this.appendSignedMessages(signedMessages);
    }
    // important that this is synchronous!
    appendSignedMessages(signedMessages) {
        if (signedMessages.length === 0)
            return;
        let previousSignature = null;
        if (this._signedMessages.length > 0) {
            previousSignature = this._signedMessages[this._signedMessages.length - 1].signature;
        }
        let messageNumber = this._signedMessages.length;
        const textLinesToAppend = [];
        for (let signedMessage of signedMessages) {
            const body = signedMessage.body;
            const signature = signedMessage.signature;
            if (!verifySignature(body, signature, this._publicKey)) {
                console.warn(body);
                console.warn(signature);
                console.warn(this._publicKey);
                throw Error(`Error verifying signature when appending signed message for: ${this._feedId} ${this._subfeedName} ${signature}`);
            }
            if ((body.previousSignature || null) !== (previousSignature || null)) {
                throw Error(`Error in previousSignature when appending signed message for: ${this._feedId} ${this._subfeedName} ${body.previousSignature} <> ${previousSignature}`);
            }
            if (body.messageNumber !== messageNumber) {
                throw Error(`Error in messageNumber when appending signed message for: ${this._feedId} ${this._subfeedName} ${body.messageNumber} <> ${messageNumber}`);
            }
            previousSignature = signedMessage.signature;
            messageNumber ++;
            this._signedMessages.push(signedMessage);
            textLinesToAppend.push(JSON.stringify(signedMessage));
        }
        fs.appendFileSync(this._subfeedMessagesPath, textLinesToAppend.join('\n') + '\n', {encoding: 'utf8'});
    }
    async getAccessRules() {
        return this._accessRules;
    }
    async setAccessRules(rules) {
        if (!this.isWriteable()) {
            throw Error(`Cannot set access rules for not writeable subfeed.`);
        }
        await writeJsonFile(this._subfeedDir + '/access', rules);
        this._accessRules = rules;
    }
}

const readMessagesFile = async (path) => {
    let txt;
    try {
        txt = await fs.promises.readFile(path, {encoding: 'utf8'});
    }
    catch(err) {
        return [];
    }
    if (typeof(txt) !== 'string') {
        console.error(txt);
        throw Error('Unexpected: txt is not a string.');
    }
    let messages = [];
    const lines = txt.split('\n');
    for (let line of lines) {
        if (line) {
            try {
                messages.push(JSON.parse(line));
            }
            catch(err) {
                console.error(line);
                console.warn(`Problem parsing JSON from file: ${path}`);
                return [];
            }
        }
    }
    return messages;
}

const readAcc = async (path) => {
    let txt;
    try {
        txt = await fs.promises.readFile(path, {encoding: 'utf8'});
    }
    catch(err) {
        return [];
    }
    if (typeof(txt) !== 'string') {
        console.error(txt);
        throw Error('Unexpected: txt is not a string.');
    }
    let messages = [];
    const lines = txt.split('\n');
    for (let line of lines) {
        if (line) {
            try {
                messages.push(JSON.parse(line));
            }
            catch(err) {
                console.error(line);
                console.warn(`Problem parsing JSON from file: ${path}`);
                return [];
            }
        }
    }
    return messages;
}

const _createSubfeedDirectoryIfNeeded = async (feedId, subfeedName) => {
    const path = _subfeedDirectory(feedId, subfeedName);
    if (!fs.existsSync(path)) {
        await fs.promises.mkdir(path, {recursive: true});
    }
}

const _createFeedDirectoryIfNeeded = async (feedId) => {
    const path = _feedDirectory(feedId);
    if (!fs.existsSync(path)) {
        await fs.promises.mkdir(path, {recursive: true});
    }
    if (!fs.existsSync(path + '/subfeeds')) {
        await fs.promises.mkdir(path + '/subfeeds', {recursive: true});
    }
}

const _feedDirectory = (feedId) => {
    return kacheryStorageDir() + `/feeds/${feedId[0]}${feedId[1]}/${feedId[2]}${feedId[3]}/${feedId[4]}${feedId[5]}/${feedId}`;
}

const _subfeedHash = (subfeedName) => {
    if (typeof(subfeedName) == 'string') {
        return sha1sum(subfeedName);
    }
    else {
        return sha1sum(JSON.stringify(subfeedName));
    }
}

const _subfeedDirectory = (feedId, subfeedName) => {
    const feedDir = _feedDirectory(feedId);
    const subfeedHash = _subfeedHash(subfeedName);
    return `${feedDir}/subfeeds/${subfeedHash[0]}${subfeedHash[1]}/${subfeedHash[2]}${subfeedHash[3]}/${subfeedHash[4]}${subfeedHash[5]}/${subfeedHash}`
}

const readJsonFile = async (path, defaultVal) => {
    try {
        const txt = await fs.promises.readFile(path);
        return JSON.parse(txt);
    }
    catch(err) {
        return defaultVal;
    }
}

const writeJsonFile = async (path, obj) => {
    const txt = JSON.stringify(obj, null, 4);
    await fs.promises.writeFile(path, txt);
}

export default FeedManager;