import fs from 'fs'
import { sleepMsec } from './common/util.js'
import Node from './Node.js';
import { createKeyPair, getSignature, verifySignature, publicKeyToHex, hexToPublicKey, hexToPrivateKey, privateKeyToHex } from './common/crypto_util.js';
import FeedManager from './FeedManager.js';
import { log, initializeLog } from './common/log.js';
import { assert } from 'console';
import { validateObject, validatePort, validateChannelName, validateNodeId } from './schema/index.js';

class Daemon {
    constructor({ configDir, listenHost, listenPort, udpListenPort, verbose, discoveryVerbose, label, bootstrapInfos, opts }) {
        // assert(typeof(configDir) === 'string');
        if (listenHost) validateObject(listenHost, '/Address');
        if (listenPort) validatePort(listenPort);
        if (udpListenPort) validatePort(udpListenPort);
        validateObject(label, '/Label');
        if (bootstrapInfos) {
            // assert(Array.isArray(bootstrapInfos));
            bootstrapInfos.forEach(bi => {
                validateObject(bi, '/BootstrapPeerInfo');
            });
        }
        this._configDir = configDir; // Directory where config information is stored (including names and keys for feeds)
        this._listenHost = listenHost; // The host where we are listening
        this._listenPort = listenPort; // The port where we are listening
        this._udpListenPort = udpListenPort; // Port where we are listening for udp messages. See below for more info.
        this._label = label;
        this._bootstrapInfos = bootstrapInfos;
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

        if (!bootstrapInfos) {
            bootstrapInfos = [
                    {address: '45.33.92.31', port: 45002}, // kachery-p2p-spikeforest
                    {address: '45.33.92.33', port: 45002} // kachery-p2p-flatiron1
                ].filter(bpi => {
                    if ((bpi.address === 'localhost') || (bpi.address === this._listenHost)) {
                        if (bpi.port === this._listenPort) {
                            return false;
                        }
                    }
                    return true;
                });
        }

        for (let bpi of bootstrapInfos) {
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

    // Find a file from remote, and store in kachery storage
    // returns on object:
    //    {onError, onFinished, cancel}
    loadFile = ({fileKey, opts}) => (this._loadFile({fileKey, opts}));

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
        validateObject(fileKey, '/FileKey');

        return this._node._findFileOrLiveFeed({fileKey, timeoutMsec});
    }

    _findLiveFeed = ({feedId, timeoutMsec}) => {
        validateObject(feedId, '/FeedId');
        // assert(typeof(timeoutMsec) === 'number');

        return this._node._findFileOrLiveFeed({fileKey: {type: 'liveFeed', feedId}, timeoutMsec});
    }

    _loadFile = ({fileKey, opts}) => {
        validateObject(fileKey, '/FileKey');
        assert(opts, 'No opts passed to daemon _loadFile');
        if (opts.fromNode) {
            validateNodeId(opts.fromNode);
        }
        if (opts.fromChannel) {
            validateChannelName(opts.fromChannel);
        }

        return this._node.loadFile({fileKey, opts});
    }
    _getLiveFeedSignedMessages = async ({channelName, nodeId, feedId, subfeedName, position, waitMsec, opts}) => {
        validateChannelName(channelName);
        validateNodeId(nodeId);
        validateObject(feedId, '/FeedId');
        validateObject(subfeedName, '/SubfeedName');
        // assert(typeof(position) === 'number');
        // assert(typeof(waitMsec) === 'number');

        log().info(`getLiveFeedSignedMessages`, {channelName, nodeId, feedId, subfeedName, position});
        const signedMessages = await this._node.getLiveFeedSignedMessages({channelName, nodeId, feedId, subfeedName, position, waitMsec, opts});
        return signedMessages;
    }
    _submitMessagesToLiveFeed = async ({channelName, nodeId, feedId, subfeedName, messages}) => {
        validateChannelName(channelName);
        validateNodeId(nodeId);
        validateObject(feedId, '/FeedId');
        validateObject(subfeedName, '/SubfeedName');

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
            await sleepMsec(10000);
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
    await fs.promises.writeFile(path, JSON.stringify(obj, null, 4));
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