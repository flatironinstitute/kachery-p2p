import fs from 'fs';
import { sleepMsec } from './util.js';
import { kacheryInfo } from './kachery.js';
import HSwarmConnection from './HSwarmConnection.js';

const PROTOCOL_VERSION = 'kachery-p2p-2'

class LookupSwarmConnection {
    constructor({nodeId, networkName, verbose}) {
        this._nodeId = nodeId;
        this._networkName = networkName;
        this._verbose = verbose;
        const swarmName = 'lookup:' + this._networkName;
        this._swarmConnection = new HSwarmConnection({nodeId, swarmName, verbose});
        this._swarmConnection.onMessage((msg) => {this._handleMessage(msg)});

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
        if (msg.type === 'seeking') {
            const fileKey = msg.fileKey;
            const fileInfo = await getLocalFileInfo({fileKey});
            if (fileInfo) {
                if ('path' in fileInfo)
                    delete fileInfo['path'];
                this._swarmConnection.broadcastMessage({
                    type: 'providing',
                    fileKey: fileKey,
                    nodeId: this._nodeId,
                    fileInfo
                });
            }
        }
    }
    findFile = ({fileKey, timeoutMsec=4000}) => {
        const onFoundCallbacks = [];
        const onFinishedCallbacks = [];
        let isFinished = false;
        const listener = this._swarmConnection.createMessageListener(
            msg => {
                return ((msg.type === 'providing') && (fileKeysMatch(msg.fileKey, fileKey)));
            }
        );
        const handleCancel = () => {
            if (isFinished) return;
            isFinished = true;
            onFinishedCallbacks.forEach(cb => cb());
        }
        const ret = {
            onFound: cb => {onFoundCallbacks.push(cb)},
            onFinished: cb => {onFinishedCallbacks.push(cb)},
            cancel: handleCancel
        }
        this._swarmConnection.broadcastMessage({
            type: 'seeking',
            fileKey
        });
        listener.onMessage(msg => {
            const result = {
                nodeId: msg.nodeId,
                fileKey: msg.fileKey,
                fileInfo: msg.fileInfo
            }
            onFoundCallbacks.forEach(cb => {cb(result);});
        });
        setTimeout(() => {
            handleCancel();
        }, timeoutMsec);
        ret.onFinished(() => {
            listener.cancel();
        })
        return ret;
    }
    // // returns a stream
    // downloadFile(nodeIdPath, kacheryPath, opts, onData) {
    //     const requestBody = {
    //         type: 'downloadFile',
    //         kacheryPath: kacheryPath
    //     };
    //     let finished = false;
    //     let sha1_sum = crypto.createHash('sha1');
    //     this.makeRequestToNode(nodeIdPath, requestBody, {}, (responseBody) => {
    //         if (!finished) {
    //             const buf = Buffer.from(responseBody.data_b64, 'base64');
    //             sha1_sum.update(buf);
    //             // todo: implement this properly so we don't overflow the stream
    //             stream.push(buf);
    //         }
    //     }, () => {
    //         finished = true;
    //         let sha1_hash = sha1_sum.digest('hex');;
    //         // todo: check hash to see if it is equal to the expected based on kacheryPath
    //         stream.push(null);
    //     });
    //     const stream = new Stream.Readable({
    //         read(size) {
    //             // todo: implement this properly so we don't overflow the stream
    //         }
    //     });

    //     return stream;
    // }
    async _start() {
        while (true) {
            //maintenance goes here
            await sleepMsec(100);
        }
    }
}

const fileKeysMatch = (k1, k2) => {
    if (k1.sha1) {
        return k1.sha1 === k2.sha1;
    }
    return false;
}

const kacheryPathFromFileKey = (fileKey) => {
    return `sha1://${fileKey.sha1}`;
}

const getLocalFileInfo = async ({fileKey}) => {
    const kacheryPath = kacheryPathFromFileKey(fileKey);
    return await kacheryInfo(kacheryPath);
}

export default LookupSwarmConnection;