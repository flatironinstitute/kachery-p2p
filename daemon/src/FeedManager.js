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
    }
    async createFeed({ feedName }) {
        const config = await this._loadFeedsConfig();
        const {publicKey, privateKey} = createKeyPair();
        const feedId = publicKeyToHex(publicKey);
        await _createFeedDirectory(feedId);
        config['feeds'][feedId] = {
            publicKey: publicKeyToHex(publicKey),
            privateKey: privateKeyToHex(privateKey)
        };
        config['feedIdsByName'][feedName] = feedId;
        await this._saveFeedsConfig(config);
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
    async appendMessages({ feedId, subfeedName, messages}) {
        const subfeed = await this._loadSubfeed(feedId, subfeedName);
        if (!subfeed.isWriteable()) {
            throw Error(`Subfeed is not writeable: ${feedId} ${subfeedName}`);
        }
        await subfeed.appendMessages(messages);
    }
    async getMessages({ feedId, subfeedName, position, maxNumMessages, waitMsec }) {
        const subfeed = await this._loadSubfeed(feedId, subfeedName);
        return await subfeed.getMessages({ position, maxNumMessages, waitMsec });
    }
    async getNumMessages({ feedId, subfeedName }) {
        const subfeed = await this._loadSubfeed(feedId, subfeedName);
        if (!subfeed) {
            throw Error(`Unable to load subfeed: ${feedId} ${subfeedName}`);
        }
        return subfeed.getNumMessages();
    }
    async getInfo({ feedId, subfeedName }) {
        const subfeed = await this._loadSubfeed(feedId, subfeedName);
        return {
            numMessages: subfeed.getNumMessages(),
            writeable: subfeed.isWriteable
        };
    }
    async _loadFeedsConfig() {
        if (!this._feedsConfig) {
            const configDir = process.env.KACHERY_P2P_CONFIG_DIR || `${os.homedir()}/.kachery-p2p`;
            const x = await readJsonFile(configDir + '/feeds.json') || {};
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
        if (feedId in this._feedsConfig.feeds) {
            return this._feedsConfig.feeds[feedId].privateKey || null;
        }
        else {
            return null;
        }
    }
    async _loadSubfeed(feedId, subfeedName) {
        const privateKey = this._getPrivateKeyForFeed;
        if (feedId in this._feedsConfig.feeds) {
            privateKey = this._feedsConfig.feeds[feedId].privateKey || null;
        }
        const k = feedId + ':' + subfeedName;
        if (!this._subfeeds[k]) {
            const sf = new Subfeed({ daemon: this._daemon, feedId, subfeedName, privateKey });
            await sf.initialize();
            this._subfeeds[k] = sf;
        }
        return this._subfeeds[k];
    }
}

class Subfeed {
    constructor({ daemon, feedId, subfeedName, privateKey }) {
        this._daemon = daemon;
        this._feedId = feedId;
        this._publicKey = hexToPublicKey(this._feedId);
        this._privateKey = privateKey;
        this._subfeedName = subfeedName;
        this._feedPath = _feedDirectory(feedId);
        this._subfeedPath = this._feedPath + '/subfeeds/' + this._subfeeds;
        this._signedMessages = null;
        this._remoteSubscription = null;
    }
    async initialize() {
        const existsLocally = fs.existsSync(this._feedDirectory(this._feedId));
        if (existsLocally) {
            const messages = await readMessagesFile(this._subfeedPath);
            let previousSignature = null;
            for (let msg of messages) {
                if (!verifySignature(msg.body, msg.signature, this._publicKey)) {
                    console.warn(msg.body);
                    console.warn(msg.signedMessage);
                    console.warn(this._publicKey);
                    throw Error(`Unable to verify signature of message in feed: ${this._feedPath}`)
                }
                if (previousSignature !== (msg.body.previousSignature || null)) {
                    throw Error(`Inconsistent previousSignature of message in feed: ${this._feedPath}`);
                }
                previousSignature = msg.signature;
            }
            this._signedMessages = messages;
        }
        else {
            this._signedMessages = [];
            this._remoteSubscription = this._daemon.subscribeToRemoteFeed(this._feedId);
        }
    }
    getNumMessages() {
        return this._signedMessages.length;
    }
    isWriteable() {
        return this._privateKey ? true : false;
    }
    async getMessages({position, maxNumMessages, waitMsec=null}) {
        const messages = [];
        if (position < this._signedMessages.length) {
            for (let i = position; i < this._signedMessages.length; i++) {
                messages.push(this._signedMessages[i].body.message);
                if (maxNumMessages) {
                    if (messages.length >= maxNumMessages)
                        break;  
                }
            }
        }
        else if (position === this._signedMessages.length) {
            if ((!this.isWriteable()) && (!this._remoteSubscription)) {
                this._remoteSubscription = this._daemon.subscribeToRemoteFeed(this._feedId);
            }
            if ((waitMsec) && (waitMsec > 0)) {
                const timer = new Date();
                while (true) {
                    // todo: use callback strategy intead (call directly from appendMessages)
                    await sleepMsec(100);
                    if (position < this._signedMessages.length) {
                        return this.getMessages({position, maxNumMessages});
                    }
                    const elapsed = (new Date()) - timer;
                    if (elapsed > waitMsec) {
                        break;
                    }
                }
            }
        }
        return messages;
    }
    async appendMessages(messages) {
        if (!this._privateKey) {
            throw Error(`Cannot write to feed without private key: ${this._privateKey}`);
        }
        let previousSignature = null;
        if (this._signedMessages.length > 0) {
            previousSignature = this._signedMessages[this._signedMessages.length - 1].signature;
        }
        const signedMessages = [];
        for (let msg of messages) {
            const body = {
                message: msg,
                previousSignature
            };
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
                throw Error(`Error verifying signature when appending signed message for: ${this._feedId} ${this._subfeedName}`);
            }
            if ((body.previousSignature || null) !== (previousSignature || null)) {
                throw Error(`Error in previousSignature when appending signed message for: ${this._feedId} ${this._subfeedName}`);
            }
            this._signedMessages.push(signedMessage);
            textLinesToAppend.push(JSON.stringify(signedMessage));
        }
        await fs.promises.appendFile(this._subfeedPath, textLinesToAppend.join('\n') + '\n', {encoding: 'utf8'});
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

const _createFeedDirectory = async (feedId) => {
    const path = _feedDirectory(feedId);
    if (fs.existsSync(path)) {
        throw Error(`Feed directory already exists: ${path}`);
    }
    await fs.promises.mkdir(path, {recursive: true});
    await fs.promises.mkdir(path + '/subfeeds');
}

const _feedDirectory = (feedId) => {
    return kacheryStorageDir() + `/feeds/${feedId[0]}${feedId[1]}/${feedId[2]}${feedId[3]}/${feedId[4]}${feedId[5]}/${feedId}`;
}

const readJsonFile = async (path) => {
    try {
        const txt = await fs.promises.readFile(path);
        return JSON.parse(txt);
    }
    catch(err) {
        return null;
    }
}

const writeJsonFile = async (path, obj) => {
    const txt = JSON.stringify(obj, null, 4);
    await fs.promises.writeFile(path, txt);
}

export default FeedManager;