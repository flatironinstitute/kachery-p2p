import os from 'os';
import fs from 'fs';
import { sleepMsec } from './util.js';
import { kacheryStorageDir } from './kachery.js';
import { createKeyPair, publicKeyToHex, privateKeyToHex, verifySignature, getSignature, hexToPublicKey, hexToPrivateKey } from './crypto_util.js'

class FeedManager {
    constructor(daemon) {
        this._daemon = daemon;
        this._storageDir = kacheryStorageDir() + '/feeds';
        this._feedsConfig = null;
        this._subfeeds = {};
        this._remoteFeedManager = new RemoteFeedManager(this._daemon);
    }
    async createFeed({ feedName }) {
        const config = await this._loadFeedsConfig();
        const {publicKey, privateKey} = createKeyPair();
        const feedId = publicKeyToHex(publicKey);
        config['feeds'][feedId] = {
            publicKey: publicKeyToHex(publicKey),
            privateKey: privateKeyToHex(privateKey)
        };
        config['feedIdsByName'][feedName] = feedId;
        await this._saveFeedsConfig(config);
        await _createFeedDirectoryIfNeeded(feedId);
        return feedId;
    }
    async getFeedId({ feedName }) {
        const config = await this._loadFeedsConfig();
        const feedId = config['feedIdsByName'][feedName] || null;
        if (feedId) {
            if (!fs.existsSync(_feedDirectory(feedId))) {
                return null;
            }
        }
        return feedId;
    }
    async hasWriteableFeed({ feedId, subfeedName}) {
        const privateKey = this._getPrivateKeyForFeed(feedId);
        if (!privateKey) return;
        return fs.existsSync(_feedDirectory(feedId));
    }
    async appendMessages({ feedId, subfeedName, messages}) {
        const subfeed = await this._loadSubfeed({feedId, subfeedName});
        if (!subfeed.isWriteable()) {
            throw Error(`Subfeed is not writeable: ${feedId} ${subfeedName}`);
        }
        await subfeed.appendMessages(messages);
    }
    async submitMessages({ feedId, subfeedName, messages}) {
        const subfeed = await this._loadSubfeed({feedId, subfeedName});
        if (subfeed.isWriteable()) {
            throw Error(`Cannot submit messages. Subfeed is writeable: ${feedId} ${subfeedName}`);
        }
        await this._remoteFeedManager.submitMessages({feedId, subfeedName, messages});
    }
    async appendSignedMessages({ feedId, subfeedName, signedMessages}) {
        const subfeed = await this._loadSubfeed({feedId, subfeedName});
        await subfeed.appendSignedMessages(signedMessages);
    }
    async getMessages({ feedId, subfeedName, position, maxNumMessages, waitMsec }) {
        const signedMessages = await this.getSignedMessages({ feedId, subfeedName, position, maxNumMessages, waitMsec})
        return signedMessages.map(sm => (sm.body.message));
    }
    async getSignedMessages({ feedId, subfeedName, position, maxNumMessages, waitMsec }) {
        const subfeed = await this._loadSubfeed({feedId, subfeedName});
        return await subfeed.getSignedMessages({ position, maxNumMessages, waitMsec });
    }
    async getNumMessages({ feedId, subfeedName }) {
        const subfeed = await this._loadSubfeed({feedId, subfeedName});
        if (!subfeed) {
            throw Error(`Unable to load subfeed: ${feedId} ${subfeedName}`);
        }
        return subfeed.getNumMessages();
    }
    async getFeedInfo({ feedId }) {
        const privateKey = await this._getPrivateKeyForFeed(feedId);
        if (privateKey) {
            return {
                isWriteable: true
            }
        }
        else {
            const liveFeedInfo = await this._remoteFeedManager.findLiveFeedInfo({feedId});
            if (!liveFeedInfo) {
                throw Error(`Unable to get info for feed: ${feedId}`);
            }
            return {
                isWriteable: false
            }
        }
    }
    async getSubfeedInfo({ feedId, subfeedName }) {
        const subfeed = await this._loadSubfeed({feedId, subfeedName});
        return {
            numMessages: subfeed.getNumMessages(),
            writeable: subfeed.isWriteable()
        };
    }
    async getAccessRules({ feedId, subfeedName }) {
        const subfeed = await this._loadSubfeed({feedId, subfeedName});
        return await subfeed.getAccessRules();
    }
    async setAccessRules({ feedId, subfeedName, rules }) {
        const subfeed = await this._loadSubfeed({feedId, subfeedName});
        await subfeed.setAccessRules(rules);
    }
    async _submitMessagesToLiveFeedFromRemoteNode({fromNodeId, feedId, subfeedName, messages}) {
        if (!(await this.hasWriteableFeed({ feedId, subfeedName }))) {
            throw Error(`Does not have writeable feed: ${feedId} ${subfeedName}`);
        }
        const subfeed = await this._loadSubfeed({feedId, subfeedName});
        if (!(await subfeed.remoteNodeHasWriteAccess(fromNodeId))) {
            throw Error(`Write access not allowed for node: ${feedId} ${subfeedName} ${fromNodeId}`);
        }
        await subfeed.appendMessages(messages, {metaData: {submittedByNodeId: fromNodeId}});
    }
    async _loadFeedsConfig() {
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
        this._feedsConfig = config;
        const configDir = process.env.KACHERY_P2P_CONFIG_DIR || `${os.homedir()}/.kachery-p2p`;
        await writeJsonFile(configDir + '/feeds.json', this._feedsConfig);
    }
    async _getPrivateKeyForFeed(feedId) {
        const config = await this._loadFeedsConfig();
        if (feedId in config.feeds) {
            return config.feeds[feedId].privateKey || null;
        }
        else {
            return null;
        }
    }
    async _loadSubfeed({feedId, subfeedName}) {
        const privateKey = await this._getPrivateKeyForFeed(feedId);
        const k = feedId + ':' + subfeedName;
        if (!this._subfeeds[k]) {
            const sf = new Subfeed({ daemon: this._daemon, remoteFeedManager: this._remoteFeedManager, feedId, subfeedName, privateKey });
            await sf.initialize();
            this._subfeeds[k] = sf;
        }
        return this._subfeeds[k];
    }
}

class RemoteFeedManager {
    constructor(daemon) {
        this._daemon = daemon;
        this._liveFeedInfos = {};
    }
    async getSignedMessages({feedId, subfeedName, position, waitMsec}) {
        const liveFeedInfo = await this.findLiveFeedInfo({feedId});
        if (!liveFeedInfo) return;
        const signedMessages = await this._daemon._getLiveFeedSignedMessages({
            primaryNodeId: liveFeedInfo.primaryNodeId,
            swarmName: liveFeedInfo.swarmName,
            feedId,
            subfeedName,
            position,
            waitMsec,
            opts: {}
        });
        return signedMessages;
    }
    async submitMessages({feedId, subfeedName, messages}) {
        const liveFeedInfo = await this.findLiveFeedInfo({feedId});
        if (!liveFeedInfo) {
            throw Error(`Cannot find live feed: ${feedId}`);
        }
        await this._daemon._submitMessagesToLiveFeed({
            primaryNodeId: liveFeedInfo.primaryNodeId,
            swarmName: liveFeedInfo.swarmName,
            feedId,
            subfeedName,
            messages
        });
    }
    async findLiveFeedInfo({feedId}) {
        if (!(feedId in this._liveFeedInfos)) {
            const asyncHelper = async () => {
                const x = this._daemon.findLiveFeed({feedId});
                x.onFound(result => {
                   this._liveFeedInfos[feedId] = result; 
                   x.cancel();
                });
                x.onFinished(() => {
                })
            }
            await asyncHelper();
        }
        return this._liveFeedInfos[feedId] || null;
    }
}

class Subfeed {
    constructor({ daemon, remoteFeedManager, feedId, subfeedName, privateKey }) {
        this._daemon = daemon;
        this._feedId = feedId;
        this._publicKey = hexToPublicKey(this._feedId);
        this._privateKey = privateKey;
        this._subfeedName = subfeedName;
        this._feedDir = _feedDirectory(feedId);
        this._subfeedFilePath = this._feedDir + '/subfeeds/' + (this._subfeedName || 'default');
        this._signedMessages = null;
        this._remoteFeedManager = remoteFeedManager;
        this._accessRules = null;
    }
    async initialize() {
        const existsLocally = fs.existsSync(_feedDirectory(this._feedId));
        if (existsLocally) {
            const messages = await readMessagesFile(this._subfeedFilePath);
            let previousSignature = null;
            for (let msg of messages) {
                if (!verifySignature(msg.body, msg.signature, this._publicKey)) {
                    console.warn(msg.body);
                    console.warn(msg.signedMessage);
                    console.warn(this._publicKey);
                    throw Error(`Unable to verify signature of message in feed: ${this._feedDir} ${msg.signature}`)
                }
                if (previousSignature !== (msg.body.previousSignature || null)) {
                    throw Error(`Inconsistent previousSignature of message in feed: ${this._feedDir} ${previousSignature} ${msg.body.previousSignature}`);
                }
                previousSignature = msg.signature;
            }
            this._signedMessages = messages;
            if (this.isWriteable()) {
                this._accessRules = await readJsonFile(this._subfeedFilePath + '.access', {rules: []});
            }
        }
        else {
            this._signedMessages = [];
            this._accessRules = null;
            await this.getSignedMessages({position: 0, maxNumMessages: 10, waitMsec: 0});
        }
    }
    getNumMessages() {
        return this._signedMessages.length;
    }
    isWriteable() {
        return this._privateKey ? true : false;
    }
    async remoteNodeHasWriteAccess(remoteNodeId) {
        if (!this._accessRules) return false;
        if (!this._accessRules.rules) return false;
        const a = this._accessRules.rules.filter(r => ((r.nodeId === remoteNodeId) && (r.write)));
        return (a.length > 0);
    }
    async getSignedMessages({position, maxNumMessages, waitMsec=null}) {
        const signedMessages = [];
        if (position < this._signedMessages.length) {
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
            if (!this.isWriteable()) {
                const remoteSignedMessages = await this._remoteFeedManager.getSignedMessages({
                    feedId: this._feedId,
                    subfeedName: this._subfeedName,
                    position: this._signedMessages.length,
                    waitMsec
                });
                if ((remoteSignedMessages) && (remoteSignedMessages.length > 0)) {
                    this.appendSignedMessages(remoteSignedMessages);
                    return this.getSignedMessages({position, maxNumMessages});
                }
            }
            else if ((waitMsec) && (waitMsec > 0)) {
                const timer = new Date();
                while (true) {
                    // todo: use callback strategy instead (call directly from appendSignedMessages)
                    await sleepMsec(100);
                    if (position < this._signedMessages.length) {
                        return this.getSignedMessages({position, maxNumMessages});
                    }
                    const elapsed = (new Date()) - timer;
                    if (elapsed > waitMsec) {
                        break;
                    }
                }
            }
        }
        return signedMessages;
    }
    async appendMessages(messages, opts) {
        opts = opts || {};
        if (!this._privateKey) {
            throw Error(`Cannot write to feed without private key: ${this._privateKey}`);
        }
        let previousSignature = null;
        if (this._signedMessages.length > 0) {
            previousSignature = this._signedMessages[this._signedMessages.length - 1].signature;
        }
        const signedMessages = [];
        for (let msg of messages) {
            let body = {
                message: msg,
                previousSignature
            };
            if (opts.metaData) {
                body.metaData = opts.metaData;
            }
            const signedMessage = {
                body,
                signature: getSignature(body, {publicKey: this._publicKey, privateKey: hexToPrivateKey(this._privateKey)})
            };
            signedMessages.push(signedMessage);
        }
        await this.appendSignedMessages(signedMessages);
    }
    async appendSignedMessages(signedMessages) {
        let previousSignature = null;
        if (this._signedMessages.length > 0) {
            previousSignature = this._signedMessages[this._signedMessages.length - 1].signature;
        }
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
                throw Error(`Error in previousSignature when appending signed message for: ${this._feedId} ${this._subfeedName} ${body.previousSignature} ${previousSignature}`);
            }
            previousSignature = signedMessage.signature;
            this._signedMessages.push(signedMessage);
            textLinesToAppend.push(JSON.stringify(signedMessage));
        }
        await _createFeedDirectoryIfNeeded(this._feedId);
        await fs.promises.appendFile(this._subfeedFilePath, textLinesToAppend.join('\n') + '\n', {encoding: 'utf8'});
    }
    async getAccessRules() {
        return this._accessRules;
    }
    async setAccessRules(rules) {
        if (!this.isWriteable()) {
            throw Error(`Cannot set access rules for not writeable subfeed.`);
        }
        await writeJsonFile(this._subfeedFilePath + '.access', rules);
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