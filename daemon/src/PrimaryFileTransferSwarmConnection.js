import { sleepMsec } from './util.js';
import HSwarmConnection from './HSwarmConnection.js';
import { getLocalFileInfo } from './kachery.js';
import fs from 'fs';
import { isNumber } from 'util';

const MAX_BYTES_PER_DOWNLOAD_REQUEST = 20e6;

class PrimaryFileTransferSwarmConnection {
    constructor({keyPair, nodeId, swarmName, verbose, feedManager}) {
        this._keyPair = keyPair;
        this._nodeId = nodeId;
        this._verbose = verbose;
        this._feedManager = feedManager;
        this._swarmName = swarmName;
        const swarmName0 = 'file-transfer:' + this._swarmName;
        this._swarmConnection = new HSwarmConnection({keyPair: this._keyPair, nodeId, swarmName: swarmName0, verbose});
        this._swarmConnection.onMessage((fromNodeId, msg) => {this._handleMessage(fromNodeId, msg)});
        this._swarmConnection.onRequest(({fromNodeId, requestId, requestBody, onResponse, onError, onFinished}) => {this._handleRequest({fromNodeId, requestId, requestBody, onResponse, onError, onFinished})})

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
    _handleRequest = async ({fromNodeId, requestId, requestBody, onResponse, onError, onFinished}) => {
        if (requestBody.type === 'downloadFile') {
            const fileInfo = await getLocalFileInfo({fileKey: requestBody.fileKey});
            const startByte = requestBody.startByte;
            const endByte = requestBody.endByte;
            if ((startByte === undefined) || (endByte === undefined) || (typeof(startByte) !== 'number') || (typeof(endByte) !== 'number')) {
                onError('Missing or incorrect fields in request: startByte, endByte.');
                return;
            }
            if (endByte <= startByte) {
                onError(`Expected startByte < endByte, but got: ${startByte} ${endByte}`);
                return;
            }
            const numBytes = endByte - startByte;
            if (numBytes > MAX_BYTES_PER_DOWNLOAD_REQUEST) {
                onError(`Too many bytes in single download request: ${numBytes} > ${MAX_BYTES_PER_DOWNLOAD_REQUEST}`);
                return;
            }
            if (fileInfo) {
                const fileSystemPath = fileInfo['path'];
                const readStream = fs.createReadStream(fileSystemPath, {start: requestBody.startByte, end: requestBody.endByte - 1 /* notice the -1 here */});
                readStream.on('data', data => {
                    onResponse({
                        data_b64: data.toString('base64')
                    });
                });
                readStream.on('end', () => {
                    onFinished();
                });
            }
            else {
                onError('Unable to find file.');
            }
        }
        else if (requestBody.type === 'getLiveFeedSignedMessages') {
            const {feedId, subfeedName, position, waitMsec} = requestBody;
            let signedMessages;
            try {
                console.log('--- Primary: getLiveFeedSignedMessages A', requestId, feedId.slice(0, 5), subfeedName, position);
                signedMessages = await this._feedManager.getSignedMessages({
                    feedId, subfeedName, position, maxNumMessages: 10, waitMsec
                });
                console.log('--- Primary: getLiveFeedSignedMessages B', requestId, feedId.slice(0, 5), subfeedName, position);
            }
            catch(err) {
                console.log('--- Primary: getLiveFeedSignedMessages C', requestId, feedId.slice(0, 5), subfeedName, position);
                console.warn(err);
                onError(`Error getting signed messages: ${err.message}`);
                return;
            }
            onResponse({
                signedMessages
            });
            onFinished();
        }
        else if (requestBody.type === 'submitMessagesToLiveFeed') {
            const {feedId, subfeedName, messages} = requestBody;
            try {
                await this._feedManager._submitMessagesToLiveFeedFromRemoteNode({
                    fromNodeId, feedId, subfeedName, messages
                });
            }
            catch(err) {
                console.warn(err);
                onError(`Error submitting messages: ${err.message}`);
                return;
            }
            // mo response needed
            onFinished();
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