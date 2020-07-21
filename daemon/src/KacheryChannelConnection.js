import crypto from 'crypto';
import fs from 'fs';
import SwarmConnection from './swarmconnection/SwarmConnection.js';
import { getLocalFileInfo } from './kachery.js';
import Stream from 'stream';
import { sleepMsec } from './common/util.js';
const MAX_BYTES_PER_DOWNLOAD_REQUEST = 20e6;
const PROTOCOL_VERSION = 'kachery-p2p-5'

class KacheryChannelConnection {
    constructor({keyPair, nodeId, channelName, verbose, discoveryVerbose, nodeInfo, feedManager}) {
        this._keyPair = keyPair; // The keypair used for signing message, the public key agrees with the node id
        this._nodeId = nodeId; // The node id, determined by the public key in the keypair
        this._channelName = channelName; // Name of the channel (related to the swarmName)
        this._feedManager = feedManager; // The feed manager (feeds are collections of append-only logs)
        this._halt = false; // Whether we have left this channel (see .leave())

        // Create the swarm connection
        const swarmName = 'kachery:' + this._channelName;
        this._swarmConnection = new SwarmConnection({
            keyPair,
            nodeId,
            swarmName,
            verbose,
            discoveryVerbose,
            nodeInfo,
            protocolVersion: PROTOCOL_VERSION
        });

        // Listen for seeking messages (when a peer is seeking a file or feed)
        this._swarmConnection.createPeerMessageListener(
            (fromNodeId, msg) => {return (msg.type === 'seeking');}
        ).onMessage((fromNodeId, msg) => {
            this._handlePeerSeeking(fromNodeId, msg);
        });

        // Listen for peer requests
        this._swarmConnection.onPeerRequest(({fromNodeId, requestBody, onResponse, onError, onFinished}) => {
            this._handlePeerRequest({fromNodeId, requestBody, onResponse, onError, onFinished});
        });

        // Start the loop
        this._start();
    }
    // Set an incoming websocket connection for a peer
    setIncomingPeerWebsocketConnection(peerId, connection) {
        this._swarmConnection.setIncomingPeerWebsocketConnection(peerId, connection);
    }
    // The number of peers
    numPeers = () => {
        return this._swarmConnection.peerIds().length;
    }
    // Sorted list of peer ids
    peerIds = () => {
        return this._swarmConnection.peerIds();
    }
    // Send a request to the swarm to find a file or a live feed
    // Returns: {onFound, onFinished, cancel}
    findFileOrLiveFeed = ({fileKey, timeoutMsec=4000}) => {
        return this._findFileOrLiveFeed({fileKey, timeoutMsec});
    }
    // Download a file (or part of a file) from a particular node in the swarm
    // returns {stream, cancel}
    downloadFile = async ({nodeId, fileKey, startByte, endByte, opts}) => {
        return await this._downloadFile({nodeId, fileKey, startByte, endByte, opts});
    }
    // Get live feed signed messages
    // Returns list of signed messages
    getLiveFeedSignedMessages = async ({nodeId, feedId, subfeedName, position, waitMsec, opts}) => {
        return await this._getLiveFeedSignedMessages({nodeId, feedId, subfeedName, position, waitMsec, opts});
    }
    // Submit messages to a live feed on a remote node
    submitMessagesToLiveFeed = async ({nodeId, feedId, subfeedName, messages}) => {
        return await this._submitMessagesToLiveFeed({nodeId, feedId, subfeedName, messages});
    }
    async leave() {
        this._halt = true;
        await this._swarmConnection.leave();
    }

    // IMPLEMENTATION ///////////////////////////////////////////////////
    _findFileOrLiveFeed = ({fileKey, timeoutMsec=4000}) => {
        const onFoundCallbacks = [];
        const onFinishedCallbacks = [];
        let isFinished = false;
        const listener = this._swarmConnection.createPeerMessageListener(
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
        this._swarmConnection.sendMessageToAllPeers({
            type: 'seeking',
            fileKey
        });
        listener.onMessage((fromNodeId, msg) => {
            if (fromNodeId !== msg.nodeId) {
                console.warn(`UNEXPECTED: msg.nodeId ${msg.nodeId} is not the same as fromNodeId ${fromNodeId}`);
                return;
            }
            if (this._channelName !== msg.channel) {
                console.warn(`UNEXPECTED: msg.channel ${msg.channel} is not the same as this._channelName ${this._channelName}`);
                return;
            }
            const result = {
                channel: msg.channel,
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
    _downloadFile = async ({nodeId, fileKey, startByte, endByte, opts}) => {
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
        
                const req = this._swarmConnection.makeRequestToPeer(nodeId, requestBody, {timeout: 10000});
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
    _getLiveFeedSignedMessages = async ({nodeId, feedId, subfeedName, position, waitMsec, opts}) => {
        return new Promise((resolve, reject) => {
            if (this._verbose >= 200) {
                console.info(':getLiveFeedSignedMessages:');
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
            const req = this._swarmConnection.makeRequestToPeer(nodeId, requestBody, {timeout: waitMsec + 10000});
            req.onResponse(responseBody => {
                if (finished) return;
                for (let signedMessage of (responseBody.signedMessages || [])) {
                    signedMessages.push(signedMessage);
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
                resolve(signedMessages);
            });
        });
    }
    async _handlePeerSeeking(fromNodeId, msg) {
        const fileKey = msg.fileKey;
        if (fileKey.sha1) {
            const fileInfo = await getLocalFileInfo({fileKey});
            if (fileInfo) {
                if ('path' in fileInfo)
                    delete fileInfo['path'];
                this._swarmConnection.sendMessageToPeer(
                    fromNodeId,
                    {
                        type: 'providing',
                        channel: this._channelName,
                        nodeId: this._nodeId,
                        fileKey,
                        fileInfo
                    }
                )
            }
        }
        else if (fileKey.feedId) {
            if (await this._feedManager.hasWriteableFeed({feedId: fileKey.feedId})) {
                this._swarmConnection.sendMessageToPeer(
                    fromNodeId,
                    {
                        type: 'providing',
                        channel: this._channelName,
                        nodeId: this._nodeId,
                        fileKey
                    }
                )
            }
        }
    }
    _submitMessagesToLiveFeed = async ({nodeId, feedId, subfeedName, messages}) => {
        return new Promise((resolve, reject) => {
            const requestBody = {
                type: 'submitMessagesToLiveFeed',
                feedId,
                subfeedName,
                messages
            };
            let finished = false;
            const req = this._swarmConnection.makeRequestToPeer(nodeId, requestBody, {timeout: 10000});
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
    async _handlePeerRequest({fromNodeId, requestBody, onResponse, onError, onFinished}) {
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
                signedMessages = await this._feedManager.getSignedMessages({
                    feedId, subfeedName, position, maxNumMessages: 10, waitMsec
                });
            }
            catch(err) {
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
    _getInfoText() {
        const lines = [];
        lines.push(`CHANNEL CONNECTION: ${this._channelName}`);
        const peerIds = this._swarmConnection.peerIds();
        for (let peerId of peerIds) {
            const p = this._swarmConnection.peerConnection(peerId);
            const ci = p.peerNodeInfo() || {};
            const hasIn = p.hasIncomingWebsocketConnection();
            const hasOut = p.hasOutgoingWebsocketConnection();
            const numRoutes = Object.keys(p.routes()).length;
            let numRoutesTo = 0;
            for (let id2 of peerIds) {
                const p2 = this._swarmConnection.peerConnection(id2);
                if (p2.hasRouteTo(peerId)) numRoutesTo ++;
            }
            lines.push(`Peer ${peerId.slice(0, 6)}...: ${ci.host || ""}:${ci.port || ""} ${ci.local ? "(local)" : ""} ${hasIn ? "in" : ""} ${hasOut ? "out" : ""} [${numRoutes}] [${numRoutesTo}]`);
        }
        return lines.join('\n');
    }
    async _start() {
        let lastInfoText = '';
        while (true) {
            if (this._halt) return;
            const infoText = this._getInfoText();
            if (infoText !== lastInfoText) {
                console.info('****************************************************************');
                console.info(infoText);
                console.info('****************************************************************');
                lastInfoText = infoText;
            }
            await sleepMsec(100);
        }
    }
}

const fileKeysMatch = (k1, k2) => {
    if (k1.sha1) {
        return k1.sha1 === k2.sha1;
    }
    else if (k1.type === 'liveFeed') {
        return ((k1.type === k2.type) && (k1.feedId === k2.feedId));
    }
    else {
        return false;
    }
}

export default KacheryChannelConnection;