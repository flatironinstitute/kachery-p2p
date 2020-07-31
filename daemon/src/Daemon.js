import fs from 'fs'
import { sleepMsec } from './common/util.js'
import { JSONStringifyDeterministic } from './common/crypto_util.js';
import Node from './new/Node.js';
import { createKeyPair, getSignature, verifySignature, publicKeyToHex, hexToPublicKey, hexToPrivateKey, privateKeyToHex } from './common/crypto_util.js';
import FeedManager from './FeedManager.js';
import { log, initializeLog } from './common/log.js';

class Daemon {
    constructor({ configDir, listenHost, listenPort, udpListenPort, verbose, discoveryVerbose, label, opts }) {
        this._configDir = configDir; // Directory where config information is stored (including names and keys for feeds)
        this._listenHost = listenHost; // The host where we are listening
        this._listenPort = listenPort; // The port where we are listening
        this._udpListenPort = udpListenPort; // Port where we are listening for udp messages. See below for more info.
        this._label = label;
        this._opts = opts;
        
        const { publicKey, privateKey } = _loadKeypair(configDir); // The keypair for signing messages and the public key is used as the node id
        this._keyPair = {publicKey, privateKey}; // the keypair
        this._nodeId = publicKeyToHex(this._keyPair.publicKey); // get the node id from the public key
        this._halted = false; // Whether we have halted the daemon

        // The feed manager -- each feed is a collection of append-only logs
        this._feedManager = new FeedManager(this);
        initializeLog(this._feedManager, {verbose: verbose, categoryOpts: {discovery: {verbose: discoveryVerbose}}});

        log().info(`Starting daemon`);

        this._node = new Node({
            nodeId: this._nodeId,
            keyPair: this._keyPair,
            address: this._listenHost,
            port: this._listenPort,
            udpAddress: this._listenHost,
            udpPort: this._listenPort,
            feedManager: this._feedManager,
            label: this._label
        });

        const bootstrapPeerInfos = [
            {address: 'localhost', port: 3008},
            {address: '45.33.92.31', port: 45001}
        ].filter(bpi => {
            if ((bpi.address === 'localhost') || (bpi.address === this._listenHost)) {
                if (bpi.port === this._listenPort) {
                    return false;
                }
            }
            return true;
        });

        for (let bpi of bootstrapPeerInfos) {
            this._node.addBootstrapPeer({address: bpi.address, port: bpi.port});
        }

        this._start();
    }

    /*****************************************************************************
    API
    ******************************************************************************/
    
    // return the node id for this node
    nodeId = () => (this._nodeId);
    // halt everything, we are stopping the daemon
    halt = () => this._halt();
    // join a particular channel (aka swarm)
    joinChannel = (channelName) => {this._node.joinChannel(channelName);};
    // leave a channel
    leaveChannel = (channelName) => {this._node.leaveChannel(channelName);};
    // return true if we have already joined the channel
    hasJoinedChannel = (channelName) => (this._node.hasJoinedChannel(channelName));
    // get the list of channel names we have joined
    joinedChannelNames = () => (this._node.joinedChannelNames());
    // get the state -- includes info about peers and channels
    getState = () => (this._getState());
    // return the feed manager
    feedManager = () => (this._feedManager);

    // Find a file
    // returns on object:
    //    {onFound, onFinished, cancel}
    findFile = ({fileKey, timeoutMsec}) => (this._findFile({fileKey, timeoutMsec}));
    // returns {stream, cancel}
    downloadFile = async ({channelName, nodeId, fileKey, fileSize, opts}) => (await this._downloadFile({channelName, nodeId, fileKey, fileSize, opts}));
    downloadFileBytes = async ({channelName, nodeId, fileKey, startByte, endByte, opts}) => (await this._downloadFileBytes({channelName, nodeId, fileKey, startByte, endByte, opts}));
    // Find a live feed
    // returns an object with:
    //   {onFound, onFinished, cancel}
    findLiveFeed = ({feedId}) => (this._findLiveFeed({feedId}));

    /*****************************************************************************
    IMPLEMENTATION
    ******************************************************************************/

    _halt = async () => {
        this._halted = true;
        this._node.halt();
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

        if (fileKey.type === 'liveFeed')
            log().info(`Finding live feed`, {fileKey});
        else
            log().info(`Finding file`, {fileKey});

        const channelNames = this.joinedChannelNames();
        channelNames.forEach(channelName => {
            const x = this._node.findFileOrLiveFeed({channelName, fileKey, timeoutMsec});
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
    _downloadFile = async ({channelName, nodeId, fileKey, fileSize}) => {
        log().info(`downloadFile`, {channelName, nodeId, fileKey, fileSize});
        return await this._node.downloadFile({channelName, nodeId, fileKey, startByte: 0, endByte: fileSize});
    }
    // returns {stream, cancel}
    _downloadFileBytes = async ({channelName, nodeId, fileKey, startByte, endByte}) => {
        log().info(`downloadFileBytes`, {channelName, nodeId, fileKey, startByte, endByte});
        return await this._node.downloadFile({channelName, nodeId, fileKey, startByte, endByte});
    }
    _getLiveFeedSignedMessages = async ({channelName, nodeId, feedId, subfeedName, position, waitMsec, opts}) => {
        log().info(`getLiveFeedSignedMessages`, {channelName, nodeId, feedId, subfeedName, position});
        const signedMessages = await this._node.getLiveFeedSignedMessages({channelName, nodeId, feedId, subfeedName, position, waitMsec, opts});
        return signedMessages;
    }
    _submitMessagesToLiveFeed = async ({channelName, nodeId, feedId, subfeedName, messages}) => {
        log().info(`submitMessagesToLiveFeed`, {channelName, nodeId, feedId, subfeedName, numMessages: messages.length});
        await this._node.submitMessagesToLiveFeed({channelName, nodeId, feedId, subfeedName, messages});
    }
    _getState = () => {
        const state = {};
        state.channels = [];
        for (let channelName of this._node.joinedChannelNames()) {
            state.channels.push({
                name: channelName
            });
        }
        return state;
    }
    async _start() {
        while (true) {
            if (this._halted) return;
            // maintenance goes here
            await sleepMsec(100);
        }
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

export default Daemon;