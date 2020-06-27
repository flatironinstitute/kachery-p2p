import SwarmConnection from './SwarmConnection.js'
import { randomString, sleepMsec } from './util.js'
import { kacheryInfo } from './kachery.js';

class Daemon {
    constructor({ verbose }) {
        this._swarmConnections = {};
        this._verbose = verbose;
        console.info(`Verbose level: ${verbose}`);

        this._start();
    }

    /*****************************************************************************
    API
    ******************************************************************************/
    
    // swarms
    joinSwarm = async (swarmName) => await this._joinSwarm(swarmName);
    leaveSwarm = async (swarmName) => await this._leaveSwarm(swarmName);
    getSwarms = () => (this._getSwarms());

    // Find a file
    findFile = async (kacheryPath, opts) => (await this._findFile(kacheryPath, opts));
    // returns a stream
    downloadFile = (swarmName, nodeIdPath, kacheryPath, opts) => (this._downloadFile(swarmName, nodeIdPath, kacheryPath, opts));

    // peers
    getPeers = () => (this._getPeers());
    disconnectPeer = (swarmName, peerId) => (this._disconnectPeer(swarmName, peerId));

    /*****************************************************************************
    IMPLEMENTATION
    ******************************************************************************/

    _joinSwarm = async (swarmName) => {
        if (swarmName in this._swarmConnections) {
            throw Error(`Cannot join swarm. Already joined: ${swarmName}`);
        }
        if (this._verbose >= 0) {
            console.info(`Joining swarm: ${swarmName}`);
        }
        this._swarmConnections[swarmName] = new SwarmConnection(swarmName, {verbose: this._verbose});
        await this._swarmConnections[swarmName].join();
    }
    _leaveSwarm = async (swarmName) => {
        if (!(swarmName in this._swarmConnections)) {
            throw Error(`Cannot leave swarm. Not joined: ${swarmName}`);
        }
        if (this._verbose >= 0) {
            console.info(`Leaving swarm: ${swarmName}`);
        }
        await this._swarmConnections[swarmName].leave();
        delete this._swarmConnections[swarmName];
    }
    _getSwarms = () => {
        const swarmNames = Object.keys(this._swarmConnections);
        return swarmNames.map((swarmName) => (
            {
                swarmName: swarmName
                // other info? num. peers?
            }
        ));
    }

    ///////////////////////////xxxxxxxxxxxxxxxxxxxxxxxxxx

    _findFile = async (kacheryPath, opts) => {
        if (this._verbose >= 1) {
            console.info(`findFile: ${kacheryPath}`);
        }
        const allResults = [];
        for (let swarmName in this._swarmConnections) {
            const swarmConnection = this._swarmConnections[swarmName];
            const output = await swarmConnection.findFile(kacheryPath, opts);
            for (let result of output.results)
                allResults.push(result);
        }
        return {results: allResults};
    }

    // returns a stream
    _downloadFile = (swarmName, nodeIdPath, kacheryPath, opts) => {
        if (this._verbose >= 1) {
            console.info(`downloadFile: ${swarmName} ${nodeIdPath.join(',')} ${kacheryPath}`);
        }
        if (!(swarmName in this._swarmConnections)) {
            throw Error(`Cannot download file. Not joined to swarm: ${swarmName}`);
        }
        const swarmConnection = this._swarmConnections[swarmName];
        return swarmConnection.downloadFile(nodeIdPath, kacheryPath, opts);
    }

    _getPeers = () => {
        let ret = [];
        for (let swarmName in this._swarmConnections) {
            let peerIds = this._swarmConnections[swarmName].peerIds();
            for (let peerId of peerIds) {
                const peerConnection = this._swarmConnections[swarmName].peerConnection(peerId);
                ret.push({
                    swarmName,
                    peerId,
                    connectionInfo: peerConnection.connectionInfo()
                })
            }
        }
        return ret;
    }
    _disconnectPeer = (swarmName, peerId) => {
        if (this._verbose >= 1) {
            console.info(`disconnectPeer: ${swarmName} ${peerId}`);
        }
        if (!(swarmName in this._swarmConnections)) {
            console.warn(`Cannot disconnect peer in swarm. Not joined: ${swarmName}`);
            return;
        }
        this._swarmConnections[peerId].disconnectPeer(peerId);
    }
    async _start() {
        while (true) {
            // maintenance goes here
            await sleepMsec(100);
        }
    }
}

export default Daemon;