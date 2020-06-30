import { randomString, sleepMsec } from './util.js'
import PrimaryFileTransferSwarmConnection from './PrimaryFileTransferSwarmConnection.js';
import SecondaryFileTransferSwarmConnection from './SecondaryFileTransferSwarmConnection.js';
import LookupSwarmConnection from './LookupSwarmConnection.js';
import swarm from 'hyperswarm';

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
    // returns {stream, cancel}
    downloadFile = async ({swarmName, primaryNodeId, fileKey, opts}) => (await this._downloadFile({swarmName, primaryNodeId, fileKey, opts}));

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
        const x = new LookupSwarmConnection({nodeId: this._nodeId, networkName, fileTransferSwarmName: this._nodeId, verbose: this._verbose});
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
            console.info(`findFile: ${JSON.stringify(fileKey)}`);
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

    // returns {stream, cancel}
    _downloadFile = async ({primaryNodeId, swarmName, fileKey, opts}) => {
        if (this._verbose >= 1) {
            console.info(`downloadFile: ${primaryNodeId} ${swarmName} ${JSON.stringify(fileKey)}`);
        }
        console.log('--- debug 1');
        if (!(swarmName in this._secondaryFileTransferSwarmConnections)) {
            await this._joinSecondaryFileTransferSwarm({swarmName, primaryNodeId});
        }
        console.log('--- debug 2');
        const swarmConnection = this._secondaryFileTransferSwarmConnections[swarmName];
        console.log('--- debug 3');
        return await swarmConnection.downloadFile({primaryNodeId, fileKey, opts});
    }
    _joinSecondaryFileTransferSwarm = async ({swarmName, primaryNodeId}) => {
        console.log('--- debug 4');
        if (swarmName in this._secondaryFileTransferSwarmConnections) {
            throw Error(`Cannot join file transfer swarm. Already joined: ${swarmName}`);
        }
        if (this._verbose >= 0) {
            console.info(`Joining file transfer: ${swarmName}`);
        }
        console.log('--- debug 5');
        const x = new SecondaryFileTransferSwarmConnection({swarmName, primaryNodeId, nodeId: this._nodeId, verbose: this._verbose});
        console.log('--- debug 6');
        await x.join();
        console.log('--- debug 7');
        this._secondaryFileTransferSwarmConnections[swarmName] = x
    }
    async _start() {
        this._primaryFileTransferSwarmConnection = new PrimaryFileTransferSwarmConnection({nodeId: this._nodeId, swarmName: this._nodeId, verbose: this._verbose});
        await this._primaryFileTransferSwarmConnection.join();
        while (true) {
            // maintenance goes here
            // for example, managing the secondary file transfer swarms that we belong to
            await sleepMsec(100);
        }
    }
}

export default Daemon;