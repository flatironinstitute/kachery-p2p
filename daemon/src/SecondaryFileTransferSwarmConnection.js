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
    downloadFile = async ({fileKey, primaryNodeId, startByte, endByte, opts}) => {
        const numBytes = endByte - startByte;

        const chunkSize = 4000000;
        const numChunks = Math.ceil(numBytes / chunkSize);
        let sha1_sum = crypto.createHash('sha1');

        const streamState = {
            readyToWrite: false,
            readyToWriteCallback: null
        }
        const stream = new Stream.Readable({
            read(size) {
                if (!streamState.readyToWrite) {
                    streamState.readyToWrite = true;
                    if (streamState.readyToWriteCallback) {
                        streamState.readyToWriteCallback();
                    }
                }
            }
        });

        const _waitForStreamReadyToWrite = async () => {
            if (streamState.readyToWrite)
                return;
            return new Promise((resolve, reject) => {
                streamState.readyToWriteCallback = resolve;
            });
        }

        let _currentReq = null;
        let _cancelled = false;
        const _handleCancel = () => {
            if (_cancelled) return;
            _cancelled = true;
            if (_currentReq) {
                _currentReq.cancel();
            }
        }

        const downloadChunk = async (chunkNum) => {
            return new Promise((resolve, reject) => {
                const chunkStartByte = startByte + chunkNum * chunkSize;
                const chunkEndByte = Math.min(chunkStartByte + chunkSize, endByte);
                const requestBody = {
                    type: 'downloadFile',
                    fileKey: fileKey,
                    startByte: chunkStartByte,
                    endByte: chunkEndByte
                };
                let finished = false;
                let bytesDownloadedThisChunk = 0;
        
                const req = this._swarmConnection.makeRequestToNode(primaryNodeId, requestBody, {timeout: 10000});
                _currentReq = req;
                req.onResponse(responseBody => {
                    if (finished) return;
                    if (!responseBody.data_b64) {
                        finished = true;
                        reject('Error downloading file. No data_b64 in response');
                        return;
                    }
                    try {
                        const buf = Buffer.from(responseBody.data_b64, 'base64');
                        sha1_sum.update(buf);
                        // todo: implement this properly so we don't overflow the stream
                        bytesDownloadedThisChunk += buf.length;
                        stream.push(buf);
                        streamState.readyToWrite = false;
                    }
                    catch(err) {
                        console.warn(err);
                        finished = true;
                        reject('Problem downloading data: ' + err.message);
                    }
                });
                req.onError(errorString => {
                    if (finished) return;
                    finished = true;
                    reject(Error(errorString));
                    return;
                })
                req.onFinished(() => {
                    if (finished) return;
                    finished = true;
                    if (bytesDownloadedThisChunk != chunkEndByte - chunkStartByte) {
                        reject(`Unexpected number of bytes for this chunk: ${bytesDownloadedThisChunk} <> ${chunkEndByte - chunkStartByte}`);
                        return;
                    }
                    resolve();
                    _currentReq = null;
                });
            });
        }

        const downloadChunks = async () => {
            for (let chunkNum = 0; chunkNum < numChunks; chunkNum ++) {
                if (!_cancelled) {
                    await _waitForStreamReadyToWrite();
                    try {
                        await downloadChunk(chunkNum);
                    }
                    catch(err) {
                        console.warn(err.message);
                        _handleCancel();
                    }
                }
            }
            // todo: check the sha1_sum here (if not cancelled)
            stream.push(null);
        }
        downloadChunks();
        return {
            stream,
            cancel: _handleCancel
        }
    }
    getLiveFeedSignedMessages = async ({primaryNodeId, feedId, subfeedName, position, waitMsec, opts}) => {
        return new Promise((resolve, reject) => {
            if (this._verbose >= 200) {
                console.info('getLiveFeedSignedMessages 1');
            }
            const requestBody = {
                type: 'getLiveFeedSignedMessages',
                feedId,
                subfeedName,
                position,
                waitMsec
            };
            let finished = false;
            const signedMessages = []
            const req = this._swarmConnection.makeRequestToNode(primaryNodeId, requestBody, {timeout: waitMsec + 10000});
            if (this._verbose >= 200) {
                console.info('Secondary: getLiveFeedSignedMessages 2');
            }
            req.onResponse(responseBody => {
                if (this._verbose >= 200) {
                    console.info('Secondary: getLiveFeedSignedMessages 3');
                }
                if (finished) return;
                for (let signedMessage of (responseBody.signedMessages || [])) {
                    signedMessages.push(signedMessage);
                }
            });
            req.onError(errorString => {
                if (this._verbose >= 200) {
                    console.info('Secondary: getLiveFeedSignedMessages 4');
                }
                if (finished) return;
                finished = true;
                reject(Error(errorString));
                return;
            })
            req.onFinished(() => {
                if (this._verbose >= 200) {
                    console.info('Secondary: getLiveFeedSignedMessages 5');
                }
                if (finished) return;
                finished = true;
                resolve(signedMessages);
            });
        });
    }
    submitMessagesToLiveFeed = async ({primaryNodeId, feedId, subfeedName, messages}) => {
        return new Promise((resolve, reject) => {
            const requestBody = {
                type: 'submitMessagesToLiveFeed',
                feedId,
                subfeedName,
                messages
            };
            let finished = false;
            const req = this._swarmConnection.makeRequestToNode(primaryNodeId, requestBody, {timeout: 10000});
            req.onResponse(responseBody => {
                if (finished) return;
                // not expecting a response
            });
            req.onError(errorString => {
                if (finished) return;
                finished = true;
                reject(Error(errorString));
                return;
            })
            req.onFinished(() => {
                if (finished) return;
                finished = true;
                resolve();
            });
        });
    }
    async _start() {
        while (true) {
            //maintenance goes here
            await sleepMsec(100);
        }
    }
}

export default SecondaryFileTransferSwarmConnection;