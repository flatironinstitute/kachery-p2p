import { sleepMsec } from './util.js';
import HSwarmConnection from './HSwarmConnection.js';
import { getLocalFileInfo } from './kachery.js';
import fs from 'fs';

class PrimaryFileTransferSwarmConnection {
    constructor({nodeId, swarmName, verbose}) {
        this._nodeId = nodeId;
        this._verbose = verbose;
        this._swarmName = swarmName;
        const swarmName0 = 'file-transfer:' + this._swarmName;
        this._swarmConnection = new HSwarmConnection({nodeId, swarmName: swarmName0, verbose});
        this._swarmConnection.onMessage(() => {this._handleMessage()});
        this._swarmConnection.onRequest((requestBody, onResponse, onFinished) => {this._handleRequest(requestBody, onResponse, onFinished)})

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
    _handleRequest = async (requestBody, onResponse, onFinished) => {
        if (requestBody.type === 'downloadFile') {
            const fileInfo = await getLocalFileInfo({fileKey: requestBody.fileKey});
            if (fileInfo) {
                const fileSystemPath = fileInfo['path'];
                const readStream = fs.createReadStream(fileSystemPath);
                readStream.on('data', data => {
                    onResponse({
                        data_b64: data.toString('base64')
                    });
                });
                readStream.on('end', () => {
                    onFinished();
                });
            }
        }
    }
    async _start() {
        while (true) {
            //maintenance goes here
            await sleepMsec(100);
        }
    }
}

export default PrimaryFileTransferSwarmConnection;