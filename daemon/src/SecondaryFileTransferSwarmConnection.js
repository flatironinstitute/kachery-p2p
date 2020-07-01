import { sleepMsec } from './util.js';
import HSwarmConnection from './HSwarmConnection.js';
import crypto from 'crypto';
import Stream from 'stream';

class SecondaryFileTransferSwarmConnection {
    constructor({keyPair, nodeId, swarmName, verbose}) {
        this._keyPair = keyPair;
        this._swarmName = swarmName;
        this._verbose = verbose;
        const swarmName0 = 'file-transfer:' + this._swarmName;
        this._swarmConnection = new HSwarmConnection({keyPair: this._keyPair, nodeId, swarmName: swarmName0, verbose});
        this._swarmConnection.onMessage((fromNodeId, msg) => {this._handleMessage(fromNodeId, msg)});

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
    _handleMessage = async (fromNodeId, msg) => {
    }
    // returns {stream, cancel}
    downloadFile = async ({fileKey, primaryNodeId, opts}) => {
        const requestBody = {
            type: 'downloadFile',
            fileKey: fileKey
        };
        let finished = false;
        let sha1_sum = crypto.createHash('sha1');

        const req = this._swarmConnection.makeRequestToNode(primaryNodeId, requestBody, {});
        req.onResponse(responseBody => {
            if (!finished) {
                const buf = Buffer.from(responseBody.data_b64, 'base64');
                sha1_sum.update(buf);
                // todo: implement this properly so we don't overflow the stream
                stream.push(buf);
            }
        });
        req.onFinished(() => {
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
        return {
            stream,
            cancel: () => req.cancel()
        }
    }
    async _start() {
        while (true) {
            //maintenance goes here
            await sleepMsec(100);
        }
    }
}

export default SecondaryFileTransferSwarmConnection;