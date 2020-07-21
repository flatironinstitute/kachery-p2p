import fs from 'fs'
import { sleepMsec } from './common/util.js'
import { JSONStringifyDeterministic } from './common/crypto_util.js';
import KacheryChannelConnection from './KacheryChannelConnection.js';
import { createKeyPair, getSignature, verifySignature, publicKeyToHex, hexToPublicKey, hexToPrivateKey, privateKeyToHex } from './common/crypto_util.js';
import FeedManager from './FeedManager.js';
import WebsocketServer from './WebsocketServer.js';
import swarm from 'hyperswarm';

class Daemon {
    constructor({ configDir, listenHost, listenPort, proxyHost, proxyPort, verbose, discoveryVerbose }) {
        // Directory where 
        this._configDir = configDir;
        this._listenHost = listenHost;
        this._listenPort = listenPort;
        this._proxyHost = proxyHost;
        this._proxyPort = proxyPort;
        
        const { publicKey, privateKey } = _loadKeypair(configDir);
        this._keyPair = {publicKey, privateKey};
        this._nodeId = publicKeyToHex(this._keyPair.publicKey);
        this._kacheryChannelConnections = {};
        this._verbose = verbose;
        this._discoveryVerbose = discoveryVerbose;
        this._halted = false;

        this._nodeInfo = {
            nodeId: this._nodeId,
            host: listenHost,
            port: listenPort
        };

        this._feedManager = new FeedManager(this, {verbose: this._verbose});

        console.info(`Verbose level: ${verbose}`);

        if (!this._listenPort) {
            throw Error('Listen port is empty.');
        }
        this._websocketServer = new WebsocketServer();
        this._websocketServer.onConnection((connection, initialInfo) => {
            const {swarmName, nodeId} = initialInfo;
            const channelName = _getChannelNameFromSwarmName(swarmName);
            if (!channelName) {
                console.warn(`Disconnecting incoming connection. Bad swarm name: ${swarmName}`);
                connection.disconnect();
                return;
            }
            if (!(channelName in this._kacheryChannelConnections)) {
                console.warn(`Disconnecting incoming connection. Not joined to channel: ${channelName}`);
                connection.disconnect();
                return;
            }
            if (!nodeId) {
                console.warn(`Disconnecting incoming connection. Empty nodeId.`);
                connection.disconnect();
                return;
            }
            this._kacheryChannelConnections[channelName].setIncomingPeerWebsocketConnection(nodeId, connection);
        });
        this._websocketServer.listen(listenPort);

        this._start();
    }

    /*****************************************************************************
    API
    ******************************************************************************/
    
    // channels (aka lookup swarms)
    nodeId = () => (this._nodeId);
    halt = async () => await this._halt();
    joinChannel = async (channelName, opts) => await this._joinChannel(channelName, opts);
    leaveChannel = async (channelName, opts) => await this._leaveChannel(channelName, opts);
    joinedChannelNames = () => {return Object.keys(this._kacheryChannelConnections)};
    getState = () => (this._getState());
    feedManager = () => (this._feedManager);

    // Find a file
    // returns on object with:
    //    onFound()
    //    onFinished()
    //    cancel()
    findFile = ({fileKey, timeoutMsec}) => (this._findFile({fileKey, timeoutMsec}));
    // returns {stream, cancel}
    downloadFile = async ({channel, nodeId, fileKey, fileSize, opts}) => (await this._downloadFile({channel, nodeId, fileKey, fileSize, opts}));
    downloadFileBytes = async ({channel, nodeId, fileKey, startByte, endByte, opts}) => (await this._downloadFileBytes({channel, nodeId, fileKey, startByte, endByte, opts}));
    // Find a live feed
    // returns an object with:
    //   onFound()
    //   onFinished()
    //   cancel()
    findLiveFeed = ({feedId}) => (this._findLiveFeed({feedId}));

    /*****************************************************************************
    IMPLEMENTATION
    ******************************************************************************/

    _halt = async () => {
        this._halted = true;
        for (let channelName of this.joinedChannelNames()) {
            await this._leaveChannel(channelName);
        }
    }
    _joinChannel = async (channelName, opts) => {
        try {
            opts = opts || {};
            if (channelName in this._kacheryChannelConnections) {
                console.warn(`Cannot join channel. Already joined: ${channelName}`);
                return;
            }
            if (this._verbose >= 0) {
                console.info(`Joining channel: ${channelName}`);
            }
            const x = new KacheryChannelConnection({
                keyPair: this._keyPair,
                nodeId: this._nodeId,
                channelName,
                verbose: this._verbose,
                discoveryVerbose: this._discoveryVerbose,
                feedManager: this._feedManager,
                nodeInfo: this._nodeInfo
            });
            this._kacheryChannelConnections[channelName] = x;
            if (!opts._skipUpdateConfig) {
                await this._updateConfigFile();
            }
        }
        catch(err) {
            console.warn(err);
            console.warn(`Problem joining channel: ${channelName}`);
        }
    }
    _leaveChannel = async (channelName, opts) => {
        try {
            opts = opts || {};
            if (!(channelName in this._kacheryChannelConnections)) {
                console.warn(`Cannot leave channel. Not joined: ${channelName}`);
                return;
            }
            if (this._verbose >= 0) {
                console.info(`Leaving channel: ${channelName}`);
            }
            await this._kacheryChannelConnections[channelName].leave();
            delete this._kacheryChannelConnections[channelName];
            if (!opts._skipUpdateConfig) {
                await this._updateConfigFile();
            }
        }
        catch(err) {
            console.warn(err);
            console.warn(`Problem leaving channel: ${channelName}`);
        }
    }

    ///////////////////////////xxxxxxxxxxxxxxxxxxxxxxxxxx

    _findFile = ({fileKey, timeoutMsec}) => {
        return this._findFileOrLiveFeed({fileKey, timeoutMsec});
    }

    _findLiveFeed = ({feedId, timeoutMsec}) => {
        return this._findFileOrLiveFeed({fileKey: {type: 'liveFeed', feedId}, timeoutMsec});
    }

    _findFileOrLiveFeed = ({fileKey, timeoutMsec}) => {
        const findOutputs = [];
        const foundCallbacks = [];
        const finishedCallbacks = [];
        let isFinished = false;
        const handleCancel = () => {
            if (isFinished) return;
            for (let x of findOutputs) {
                x.cancel();
            }
            isFinished = true;
            finishedCallbacks.forEach(cb => cb());
        }
        const ret = {
            onFound: cb => {foundCallbacks.push(cb)},
            onFinished: cb => {finishedCallbacks.push(cb)},
            cancel: handleCancel
        };
        if (this._verbose >= 1) {
            if (fileKey.type === 'liveFeed')
                console.info(`find live feed: ${JSONStringifyDeterministic(fileKey)}`);
            else
                console.info(`find file: ${JSONStringifyDeterministic(fileKey)}`);
        }
        const channelNames = Object.keys(this._kacheryChannelConnections);
        channelNames.forEach(channelName => {
            const kacheryChannelConnection = this._kacheryChannelConnections[channelName];
            const x = kacheryChannelConnection.findFileOrLiveFeed({fileKey, timeoutMsec});
            findOutputs.push(x);
            x.onFound(result => {
                if (isFinished) return;
                foundCallbacks.forEach(cb => cb(result));
            });
            x.onFinished(() => {x.finished=true; checkFinished();});
        });
        const checkFinished = () => {
            if (isFinished) return;
            for (let x of findOutputs) {
                if (!x.finished) return;
            }
            isFinished = true;
            finishedCallbacks.forEach(cb => cb());
        }
        checkFinished();
        return ret;
    }

    // returns {stream, cancel}
    _downloadFile = async ({channel, nodeId, fileKey, fileSize, opts}) => {
        if (this._verbose >= 1) {
            console.info(`downloadFile: ${channel} ${nodeId.slice(0, 8)} ${JSONStringifyDeterministic(fileKey)} ${fileSize}`);
        }
        if (!(channel in this._kacheryChannelConnections)) {
            throw Error(`Cannot download file... not joined to channel: ${channel}`)
        }
        const kacheryChannelConnection = this._kacheryChannelConnections[channel];
        return await kacheryChannelConnection.downloadFile({nodeId, fileKey, startByte: 0, endByte: fileSize, opts});
    }
    // returns {stream, cancel}
    _downloadFileBytes = async ({channel, nodeId, fileKey, startByte, endByte, opts}) => {
        if (this._verbose >= 1) {
            console.info(`downloadFileBytes: ${channel} ${nodeId.slice(0, 8)} ${JSONStringifyDeterministic(fileKey)} ${startByte} ${endByte}`);
        }
        if (!(channel in this._kacheryChannelConnections)) {
            throw Error(`Cannot download file bytes... not joined to channel: ${channel}`)
        }
        const kacheryChannelConnection = this._kacheryChannelConnections[channel];
        return await kacheryChannelConnection.downloadFile({nodeId, fileKey, startByte, endByte, opts});
    }
    _getLiveFeedSignedMessages = async ({channel, nodeId, feedId, subfeedName, position, waitMsec, opts}) => {
        if (this._verbose >= 1) {
            console.info(`getLiveFeedSignedMessages: ${channel} ${nodeId.slice(0, 8)} ${feedId.slice(0, 8)} ${subfeedName} ${position}`);
        }
        if (!(channel in this._kacheryChannelConnections)) {
            throw Error(`Cannot get live feed signed messages... not joined to channel: ${channel}`)
        }
        const kacheryChannelConnection = this._kacheryChannelConnections[channel];
        const signedMessages = await kacheryChannelConnection.getLiveFeedSignedMessages({nodeId, feedId, subfeedName, position, waitMsec, opts});
        return signedMessages;
    }
    _submitMessagesToLiveFeed = async ({channel, nodeId, feedId, subfeedName, messages}) => {
        if (this._verbose >= 1) {
            console.info(`submitMessagesToLiveFeed: ${channel} ${nodeId.slice(0, 8)} ${feedId.slice(0, 8)} ${subfeedName} ${messages.length}`);
        }
        if (!(channel in this._kacheryChannelConnections)) {
            throw Error(`Cannot submit messages to live feed... not joined to channel: ${channel}`)
        }
        const kacheryChannelConnection = this._kacheryChannelConnections[channel];
        await kacheryChannelConnection.submitMessagesToLiveFeed({nodeId, feedId, subfeedName, messages});
    }
    _getState = () => {
        const state = {};
        state.channels = [];
        for (let channelName in this._kacheryChannelConnections) {
            const kacheryChannelConnection = this._kacheryChannelConnections[channelName];
            state.channels.push({
                name: channelName,
                numPeers: kacheryChannelConnection.numPeers()
            });
        }
        return state;
    }
    async _start() {
        const config = await this._readConfigFile();
        const channels = config['channels'] || [];
        for (let ch of channels) {
            await this.joinChannel(ch.name, {_skipUpdateConfig: true});
        }
        while (true) {
            if (this._halted) return;
            // maintenance goes here
            await sleepMsec(100);
        }
    }
    _updateConfigFile = async () => {
        const config = await this._readConfigFile() || [];
        config.channels = [];
        for (let channelName in this._kacheryChannelConnections) {
            config.channels.push({
                name: channelName
            })
        }
        await this._writeConfigFile(config);
    }
    _readConfigFile = async () => {
        return await readJsonFile(this._configDir + '/config.json') || {};
    }
    _writeConfigFile = async (config) => {
        await writeJsonFile(this._configDir + '/config.json', config);
    }
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
    await fs.promises.writeFile(path, JSONStringifyDeterministic(obj, null, 4));
}

const _loadKeypair = (configDir) => {
    if (!fs.existsSync(configDir)) {
        throw Error(`Config directory does not exist: ${configDir}`);
    }
    const publicKeyPath = `${configDir}/public.pem`;
    const privateKeyPath = `${configDir}/private.pem`;
    if (fs.existsSync(publicKeyPath)) {
        if (!fs.existsSync(privateKeyPath)) {
            throw Error(`Public key file exists, but secret key file does not.`);
        }
    }
    else {
        const {publicKey, privateKey} = createKeyPair();
        fs.writeFileSync(publicKeyPath, publicKey, {encoding: 'utf-8'});
        fs.writeFileSync(privateKeyPath, privateKey, {encoding: 'utf-8'});
        fs.chmodSync(privateKeyPath, fs.constants.S_IRUSR | fs.constants.S_IWUSR);
    }
    
    const keyPair = {
        publicKey: fs.readFileSync(publicKeyPath, {encoding: 'utf-8'}),
        privateKey: fs.readFileSync(privateKeyPath, {encoding: 'utf-8'}),
    }
    testKeyPair(keyPair);
    return keyPair;
}

const testKeyPair = (keyPair) => {
    const signature = getSignature({test: 1}, keyPair);
    if (!verifySignature({test: 1}, signature, keyPair.publicKey)) {
        throw new Error('Problem testing public/private keys. Error verifying signature.');
    }
    if (hexToPublicKey(publicKeyToHex(keyPair.publicKey)) !== keyPair.publicKey) {
        console.warn(hexToPublicKey(publicKeyToHex(keyPair.publicKey)));
        console.warn(keyPair.publicKey);
        throw new Error('Problem testing public/private keys. Error converting public key to/from hex.');
    }
    if (hexToPrivateKey(privateKeyToHex(keyPair.privateKey)) !== keyPair.privateKey) {
        throw new Error('Problem testing public/private keys. Error converting private key to/from hex.');
    }
}

const _getChannelNameFromSwarmName = (swarmName) => {
    if (!(swarmName.startsWith('kachery:'))) return null;
    return swarmName.slice('kachery:'.length);
}

export default Daemon;