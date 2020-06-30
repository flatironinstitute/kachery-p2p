import fs from 'fs';
import { sleepMsec } from './util.js';
import { getLocalFileInfo } from './kachery.js';
import HSwarmConnection from './HSwarmConnection.js';

class LookupSwarmConnection {
    constructor({nodeId, networkName, fileTransferSwarmName, verbose}) {
        this._nodeId = nodeId;
        this._networkName = networkName;
        this._verbose = verbose;
        const swarmName = 'lookup:' + this._networkName;
        this._fileTransferSwarmName = fileTransferSwarmName;
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
                    primaryNodeId: this._nodeId,
                    swarmName: this._fileTransferSwarmName,
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
                primaryNodeId: msg.primaryNodeId,
                swarmName: msg.swarmName,
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

export default LookupSwarmConnection;