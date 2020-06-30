import { sleepMsec } from './util.js';
import HSwarmConnection from './HSwarmConnection.js';
import { Stream } from 'json-socket';

const PROTOCOL_VERSION = 'kachery-p2p-2'

class SecondaryFileTransferSwarmConnection {
    constructor({nodeId, primaryNodeId, verbose}) {
        this._primaryNodeId = primaryNodeId;
        this._nodeId = nodeId;
        this._verbose = verbose;
        const swarmName = 'file-transfer:' + this._primaryNodeId;
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
    // returns a stream
    downloadFile = async (fileKey, opts) => {
        const requestBody = {
            type: 'downloadFile',
            kacheryPath: kacheryPath
        };
        let finished = false;
        let sha1_sum = crypto.createHash('sha1');
        this._swarmConnection.makeRequestToNode(this._primaryNodeId, requestBody, (responseBody) => {
            if (!finished) {
                const buf = Buffer.from(responseBody.data_b64, 'base64');
                sha1_sum.update(buf);
                // todo: implement this properly so we don't overflow the stream
                stream.push(buf);
            }
        }, () => {
            finished = true;
            let sha1_hash = sha1_sum.digest('hex');;
            // todo: check hash to see if it is equal to the expected based on kacheryPath
            stream.push(null);
        });
        const stream = new Stream.Readable({
            read(size) {
                // todo: implement this properly so we don't overflow the stream
            }
        });
        return stream;
    }
    async _start() {
        while (true) {
            //maintenance goes here
            await sleepMsec(100);
        }
    }
}

export default SecondaryFileTransferSwarmConnection;