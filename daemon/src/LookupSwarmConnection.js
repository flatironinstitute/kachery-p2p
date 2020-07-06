import fs from 'fs';
import { sleepMsec } from './util.js';
import { getLocalFileInfo } from './kachery.js';
import HSwarmConnection from './HSwarmConnection.js';

class LookupSwarmConnection {
    constructor({keyPair, nodeId, channelName, fileTransferSwarmName, verbose}) {
        this._keyPair = keyPair;
        this._nodeId = nodeId;
        this._channelName = channelName;
        this._verbose = verbose;
        const swarmName = 'lookup:' + this._channelName;
        this._fileTransferSwarmName = fileTransferSwarmName;
        this._swarmConnection = new HSwarmConnection({keyPair: this._keyPair, nodeId, swarmName, verbose});
        this._swarmConnection.onMessage((fromNodeId, msg) => {this._handleMessage(fromNodeId, msg)});
        this._nodeIdsInSwarm = {[nodeId]: true};

        this._start();
    }
    async join() {
        await this._swarmConnection.join();
        this._swarmConnection.broadcastMessage({
            type: 'joining'
        });
    }
    async leave() {
        this._swarmConnection.broadcastMessage({
            type: 'leaving'
        });
        await sleepMsec(100);
        await this._swarmConnection.leave();
    }
    printInfo() {
        this._swarmConnection.printInfo();
    }
    _handleMessage = async (fromNodeId, msg) => {
        if (msg.type === 'seeking') {
            const fileKey = msg.fileKey;
            const fileInfo = await getLocalFileInfo({fileKey});
            if (fileInfo) {
                if ('path' in fileInfo)
                    delete fileInfo['path'];
                // Question: do we want to send this only to the node seeking, or to all?
                this._swarmConnection.broadcastMessage({
                    type: 'providing',
                    fileKey: fileKey,
                    primaryNodeId: this._nodeId,
                    swarmName: this._fileTransferSwarmName,
                    fileInfo
                });
            }
        }
        else if (msg.type === 'joining') {
            this._nodeIdsInSwarm[fromNodeId] = true;
            this._swarmConnection.sendMessageToNode(fromNodeId, {
                type: 'introducing'
            });
        }
        else if (msg.type === 'introducing') {
            this._nodeIdsInSwarm[fromNodeId] = true;
        }
        else if (msg.type === 'leaving') {
            if (fromNodeId in this._nodeIdsInSwarm) {
                delete this._nodeIdsInSwarm[fromNodeId];
            }
        }
    }
    findFile = ({fileKey, timeoutMsec=4000}) => {
        const onFoundCallbacks = [];
        const onFinishedCallbacks = [];
        let isFinished = false;
        const listener = this._swarmConnection.createMessageListener(
            (fromNodeId, msg) => {
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
        listener.onMessage((fromNodeId, msg) => {
            if (fromNodeId !== msg.primaryNodeId) {
                console.warn(`WARNING: primaryNodeId ${msg.primaryNodeId} is not the same as fromNodeId ${fromNodeId}`);
            }
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