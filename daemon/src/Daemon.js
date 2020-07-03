import fs from 'fs'
import { randomString, sleepMsec } from './util.js'
import PrimaryFileTransferSwarmConnection from './PrimaryFileTransferSwarmConnection.js';
import SecondaryFileTransferSwarmConnection from './SecondaryFileTransferSwarmConnection.js';
import LookupSwarmConnection from './LookupSwarmConnection.js';
import { createKeyPair, getSignature, verifySignature, publicKeyToHex } from './crypto_util.js';

class Daemon {
    constructor({ configDir, verbose }) {
        this._configDir = configDir;
        
        const { publicKey, privateKey } = _loadKeypair(configDir);
        this._keyPair = {publicKey, privateKey};
        this._nodeId = publicKeyToHex(this._keyPair.publicKey);
        this._lookupSwarmConnections = {};
        this._primaryFileTransferSwarmConnection = null;
        this._secondaryFileTransferSwarmConnections = {};
        this._verbose = verbose;
        console.info(`Verbose level: ${verbose}`);

        this._start();
    }

    /*****************************************************************************
    API
    ******************************************************************************/
    
    // channels (aka lookup swarms)
    joinChannel = async (channelName, opts) => await this._joinChannel(channelName, opts);
    leaveChannel = async (channelName, opts) => await this._leaveChannel(channelName, opts);
    joinedChannelNames = () => {return Object.keys(this._lookupSwarmConnections)};
    getState = () => (this._getState());

    // Find a file
    // returns on object with:
    //    onFound()
    //    onFinished()
    //    cancel()
    findFile = ({fileKey, timeoutMsec}) => (this._findFile({fileKey, timeoutMsec}));
    // returns {stream, cancel}
    downloadFile = async ({swarmName, primaryNodeId, fileKey, fileSize, opts}) => (await this._downloadFile({swarmName, primaryNodeId, fileKey, fileSize, opts}));

    /*****************************************************************************
    IMPLEMENTATION
    ******************************************************************************/

    _joinChannel = async (channelName, opts) => {
        try {
            opts = opts || {};
            if (channelName in this._lookupSwarmConnections) {
                console.warn(`Cannot join channel. Already joined: ${channelName}`);
                return;
            }
            if (this._verbose >= 0) {
                console.info(`Joining channel: ${channelName}`);
            }
            const x = new LookupSwarmConnection({keyPair: this._keyPair, nodeId: this._nodeId, channelName, fileTransferSwarmName: this._nodeId, verbose: this._verbose});
            await x.join();
            this._lookupSwarmConnections[channelName] = x;
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
            if (!(channelName in this._lookupSwarmConnections)) {
                console.warn(`Cannot leave channel. Not joined: ${channelName}`);
                return;
            }
            if (this._verbose >= 0) {
                console.info(`Leaving channel: ${channelName}`);
            }
            await this._lookupSwarmConnections[channelName].leave();
            delete this._lookupSwarmConnections[channelName];
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
            console.info(`findFile: ${JSON.stringify(fileKey)}`);
        }
        const channelNames = Object.keys(this._lookupSwarmConnections);
        channelNames.forEach(channelName => {
            const lookupSwarmConnection = this._lookupSwarmConnections[channelName];
            const x = lookupSwarmConnection.findFile({fileKey, timeoutMsec});
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
    _downloadFile = async ({primaryNodeId, swarmName, fileKey, fileSize, opts}) => {
        if (this._verbose >= 1) {
            console.info(`downloadFile: ${primaryNodeId} ${swarmName} ${JSON.stringify(fileKey)} ${fileSize}`);
        }
        if (!(swarmName in this._secondaryFileTransferSwarmConnections)) {
            await this._joinSecondaryFileTransferSwarm({swarmName, primaryNodeId});
        }
        const swarmConnection = this._secondaryFileTransferSwarmConnections[swarmName];
        return await swarmConnection.downloadFile({primaryNodeId, fileKey, fileSize, opts});
    }
    _joinSecondaryFileTransferSwarm = async ({swarmName, primaryNodeId}) => {
        if (swarmName in this._secondaryFileTransferSwarmConnections) {
            throw Error(`Cannot join file transfer swarm. Already joined: ${swarmName}`);
        }
        if (this._verbose >= 0) {
            console.info(`Joining file transfer: ${swarmName}`);
        }
        const x = new SecondaryFileTransferSwarmConnection({keyPair: this._keyPair, swarmName, primaryNodeId, nodeId: this._nodeId, verbose: this._verbose});
        await x.join();
        this._secondaryFileTransferSwarmConnections[swarmName] = x
    }
    _getState = () => {
        const state = {};
        state.channels = [];
        for (let channelName in this._lookupSwarmConnections) {
            const lookupSwarmConnection = this._lookupSwarmConnections[channelName];
            state.channels.push({
                name: channelName,
                numPeers: lookupSwarmConnection._swarmConnection.numPeers()
            });
        }
        return state;
    }
    async _start() {
        this._primaryFileTransferSwarmConnection = new PrimaryFileTransferSwarmConnection({keyPair: this._keyPair, nodeId: this._nodeId, swarmName: this._nodeId, verbose: this._verbose});
        await this._primaryFileTransferSwarmConnection.join();
        const config = await this._readConfigFile();
        const channels = config['channels'] || [];
        for (let ch of channels) {
            await this.joinChannel(ch.name, {_skipUpdateConfig: true});
        }
        while (true) {
            // maintenance goes here
            // for example, managing the secondary file transfer swarms that we belong to
            await sleepMsec(100);
        }
    }
    _updateConfigFile = async () => {
        const config = await this._readConfigFile() || [];
        config.channels = [];
        for (let channelName in this._lookupSwarmConnections) {
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
    await fs.promises.writeFile(path, JSON.stringify(obj, null, 4));
}

const _loadKeypair = (configDir) => {
    if (!fs.existsSync(configDir)) {
        throw Error(`Config directory does not exist: ${configDir}`);
    }
    const publicKeyPath = `${configDir}/public.pem`;
    const privateKeyPath = `${configDir}/private.pem`;
    if ((fs.existsSync(publicKeyPath)) && (false)) {
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
    if (!testKeyPair(keyPair)) {
        throw new Error('Problem testing public/private keys.')
    }
    return keyPair;
}

const testKeyPair = (keyPair) => {
    const signature = getSignature({test: 1}, keyPair);
    const verify0 = verifySignature({test: 1}, signature, keyPair.publicKey);
    return verify0;
}

export default Daemon;