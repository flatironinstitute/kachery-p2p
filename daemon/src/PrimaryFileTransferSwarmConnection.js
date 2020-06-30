import { sleepMsec } from './util.js';
import HSwarmConnection from './HSwarmConnection.js';

const PROTOCOL_VERSION = 'kachery-p2p-2'

class PrimaryFileTransferSwarmConnection {
    constructor({nodeId, verbose}) {
        this._nodeId = nodeId;
        this._verbose = verbose;
        const swarmName = 'file-transfer:' + this._nodeId;
        this._swarmConnection = new HSwarmConnection({nodeId, swarmName, verbose});
        this._swarmConnection.onMessage(() => {this._handleMessage()});

        this._start();
    }
    async join() {
        await this._swarmConnection.join();
    }
    async leave() {
        await this._swarmConnection.leave();
    }
    printInfo() {
        this._swarmConnection.printInfo();
    }
    _handleMessage = async msg => {
    }
    async _start() {
        while (true) {
            //maintenance goes here
            await sleepMsec(100);
        }
    }
}

export default PrimaryFileTransferSwarmConnection;