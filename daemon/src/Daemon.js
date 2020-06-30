import { randomString, sleepMsec } from './util.js'
import PrimaryFileTransferSwarmConnection from './PrimaryFileTransferSwarmConnection.js';
import SecondaryFileTransferSwarmConnection from './SecondaryFileTransformSwarmConnection.js';
import LookupSwarmConnection from './LookupSwarmConnection.js';

class Daemon {
    constructor({ verbose }) {
        // todo: use public/private key pair and use public key for node id
        this._nodeId = randomString(10);
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
    
    // networks (aka lookup swarms)
    joinNetwork = async (networkName) => await this._joinNetwork(networkName);
    leaveNetwork = async (networkName) => await this._leaveNetwork(networkName);
    joinedNetworkNames = () => {return Object.keys(this._lookupSwarmConnections)};

    // Find a file
    // returns on object with:
    //    onFound()
    //    onFinished()
    //    cancel()
    findFile = ({fileKey, timeoutMsec}) => (this._findFile({fileKey, timeoutMsec}));
    // returns a stream
    downloadFile = async (nodeId, fileKey, opts) => (await this._downloadFile(nodeId, fileKey, opts));

    /*****************************************************************************
    IMPLEMENTATION
    ******************************************************************************/

    _joinNetwork = async (networkName) => {
        if (networkName in this._lookupSwarmConnections) {
            throw Error(`Cannot join network. Already joined: ${networkName}`);
        }
        if (this._verbose >= 0) {
            console.info(`Joining network: ${networkName}`);
        }
        const x = new LookupSwarmConnection({nodeId: this._nodeId, networkName, verbose: this._verbose});
        await x.join();
        this._lookupSwarmConnections[networkName] = x;
    }
    _leaveNetwork = async (networkName) => {
        if (!(networkName in this._networkConnections)) {
            throw Error(`Cannot leave network. Not joined: ${networkName}`);
        }
        if (this._verbose >= 0) {
            console.info(`Leaving network: ${networkName}`);
        }
        await this._lookupSwarmConnections[networkName].leave();
        delete this._lookupSwarmConnections[networkName];
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
            console.info(`findFile: ${JSON.stringify(key)}`);
        }
        const networkNames = Object.keys(this._lookupSwarmConnections);
        networkNames.forEach(networkName => {
            const lookupSwarmConnection = this._lookupSwarmConnections[networkName];
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

    // returns a stream
    _downloadFile = async (nodeId, fileKey, opts) => {
        if (this._verbose >= 1) {
            console.info(`downloadFile: ${nodeId} ${JSON.stringify(key)}`);
        }
        if (!(nodeId in this._secondaryFileTransferSwarmConnections)) {
            await this._joinSecondaryFileTransferSwarm(nodeId);
        }
        const swarmConnection = this._secondaryFileTransferSwarmConnections[nodeId];
        return await swarmConnection.downloadFile(fileKey, opts);
    }
    _joinSecondaryFileTransferSwarm = async nodeId => {
        if (nodeId in this._secondaryFileTransferSwarmConnections) {
            throw Error(`Cannot join file transfer swarm. Already joined: ${nodeId}`);
        }
        if (this._verbose >= 0) {
            console.info(`Joining file transfer: ${nodeId}`);
        }
        const x = new SecondaryFileTransferSwarmConnection({primaryNodeId: nodeId, nodeId: this._nodeId, verbose: this._verbose});
        await x.join();
        this._secondaryFileTransferSwarmConnections[nodeId] = x
    }
    async _start() {
        this._primaryFileTransferSwarmConnection = new PrimaryFileTransferSwarmConnection(this._nodeId);
        while (true) {
            // maintenance goes here
            // for example, managing the secondary file transfer swarms that we belong to
            await sleepMsec(100);
        }
    }
}

export default Daemon;