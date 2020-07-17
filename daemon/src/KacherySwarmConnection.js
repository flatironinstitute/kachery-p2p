import crypto from 'crypto';
import fs from 'fs';
import { sleepMsec, randomString } from './util.js';
import { getLocalFileInfo } from './kachery.js';
import HyperswarmConnection from './HyperswarmConnection.js';
import Stream from 'stream';
import KacheryPeerConnection from './KacheryPeerConnection.js';

const MAX_BYTES_PER_DOWNLOAD_REQUEST = 20e6;

class KacherySwarmConnection {
    constructor({keyPair, nodeId, channelName, verbose, feedManager, nodeInfo}) {
        this._keyPair = keyPair;
        this._nodeId = nodeId;
        this._channelName = channelName;
        this._verbose = verbose;
        const swarmName = 'kachery:' + this._channelName;
        this._hyperswarmConnection = new HyperswarmConnection({keyPair: this._keyPair, nodeId, swarmName, verbose});
        this._hyperswarmConnection.onMessage((fromNodeId, msg, isLocal) => {this._handleHyperswarmMessage(fromNodeId, msg, isLocal)});
        this._hyperswarmConnection.onPeerConnection(() => {this._announce();})
        this._hyperswarmNodeIds = {};
        this._feedManager = feedManager;
        this._nodeInfo = nodeInfo;
        this._peerConnections = {};
        this._peerMessageListeners = {};

        this._start();
    }
    async join() {
        await this._hyperswarmConnection.join();
        this._announce();
    }
    _announce() {
        // todo: NOTE: we also need to announce if a new node joins the swarm but is not a hyperswarm peer
        this._hyperswarmConnection.broadcastMessage({
            type: 'announce',
            nodeInfo: this._nodeInfo
        });
    }
    async leave() {
        this._hyperswarmConnection.broadcastMessage({
            type: 'leaving',
            nodeInfo: this._nodeInfo
        });
        await sleepMsec(100);
        await this._hyperswarmConnection.leave();
    }
    numPeers = () => {
        return Object.keys(this._peerConnections).length;
    }
    printInfo() {
        this._hyperswarmConnection.printInfo();
    }
    setIncomingPeerConnection(peerId, connection) {
        if (!(peerId in this._peerConnections)) {
            console.warn(`Closing incoming connection. No peer: ${peerId}`);
            connection.disconnect();
            return;
        }
        this._peerConnections[peerId].setIncomingConnection(connection);
    }
    // returns {stream, cancel}
    downloadFile = async ({nodeId, fileKey, startByte, endByte, opts}) => {
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
        
                const req = this._makeRequestToNode(nodeId, requestBody, {timeout: 10000});
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
    getLiveFeedSignedMessages = async ({nodeId, feedId, subfeedName, position, waitMsec, opts}) => {
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
            const req = this._makeRequestToNode(nodeId, requestBody, {timeout: waitMsec + 10000});
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
    submitMessagesToLiveFeed = async ({nodeId, feedId, subfeedName, messages}) => {
        return new Promise((resolve, reject) => {
            const requestBody = {
                type: 'submitMessagesToLiveFeed',
                feedId,
                subfeedName,
                messages
            };
            let finished = false;
            const req = this._makeRequestToNode(nodeId, requestBody, {timeout: 10000});
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
    findFileOrLiveFeed = ({fileKey, timeoutMsec=4000}) => {
        const onFoundCallbacks = [];
        const onFinishedCallbacks = [];
        let isFinished = false;
        const listener = this._createKacheryPeerMessageListener(
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
        this._sendMessageToAllKacheryPeers({
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
    _handleMessageFromKacheryPeer = async (fromNodeId, msg) => {
        if (msg.type === 'seeking') {
            const fileKey = msg.fileKey;
            if (fileKey.sha1) {
                const fileInfo = await getLocalFileInfo({fileKey});
                if (fileInfo) {
                    if ('path' in fileInfo)
                        delete fileInfo['path'];
                    this._sendMessageToKacheryPeer(
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
                    this._sendMessageToKacheryPeer(
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
        else if (msg.type === 'requestToNode') {
            if (msg.toNodeId === this._nodeId) {
                const requestId = msg.requestId;
                this._sendMessageToKacheryPeer(fromNodeId, {type: 'requestToNodeReceived', requestId});
                this._handleRequest({
                    fromNodeId,
                    requestId,
                    requestBody: msg.requestBody,
                    onResponse: responseBody => {
                        this._sendMessageToKacheryPeer(fromNodeId, {type: 'requestToNodeResponse', requestId, responseBody});
                    },
                    onError: errorString => {
                        this._sendMessageToKacheryPeer(fromNodeId, {type: 'requestToNodeError', requestId, errorString})
                    },
                    onFinished: () => {
                        this._sendMessageToKacheryPeer(fromNodeId, {type: 'requestToNodeFinished', requestId});
                    }
                });
            }
        }
        else {
            for (let id in this._peerMessageListeners) {
                const x = this._peerMessageListeners[id];
                if (x.testFunction(fromNodeId, msg)) {
                    x.onMessageCallbacks.forEach(cb => {cb(fromNodeId, msg);});
                }
            }
        }
    }
    _handleHyperswarmMessage = async (fromNodeId, msg, isLocal) => {
        if (msg.type === 'announce') {
            this._hyperswarmNodeIds[fromNodeId] = true;
            await this._updatePeerConnection(fromNodeId);
            this._peerConnections[fromNodeId].setPeerIsLocal(isLocal);
            this._peerConnections[fromNodeId].setPeerInfo(msg.nodeInfo);
        }
        else if (msg.type === 'leaving') {
            if (fromNodeId in this._hyperswarmNodeIds) {
                delete this._hyperswarmNodeIds[fromNodeId];
                await this._updatePeerConnection(fromNodeId);
            }
        }
    }
    _updatePeerConnection = async (peerId) => {
        if ((peerId in this._hyperswarmNodeIds) && (!(peerId in this._peerConnections))) {
            const P = new KacheryPeerConnection({peerId, nodeId: this._nodeId, channel: this._channelName, verbose: this._verbose});
            this._peerConnections[peerId] = P;
            P.onMessage(msg => {
                this._handleMessageFromKacheryPeer(peerId, msg);
            })
        }
        if (!(peerId in this._hyperswarmNodeIds) && (peerId in this._peerConnections)) {
            this._peerConnections[peerId].disconnect();
            delete this._peerConnections[peerId];
        }
    }
    _createKacheryPeerMessageListener(testFunction) {
        const x = {
            id: randomString(),
            testFunction,
            onMessageCallbacks: []
        };
        this._peerMessageListeners[x.id] = x;
        return {
            onMessage: cb => {x.onMessageCallbacks.push(cb);},
            cancel: () => {
                delete this._peerMessageListeners[x.id]
            }
        };
    }
    _sendMessageToAllKacheryPeers(msg) {
        for (let peerId in this._peerConnections) {
            this._sendMessageToKacheryPeer(peerId, msg);
        }
    }
    _sendMessageToKacheryPeer(peerId, msg) {
        if (!(peerId in this._peerConnections)) {
            console.warn(`Unable to send message ... no peer connection to ${peerId}`);
            return;
        }
        this._peerConnections[peerId].sendMessage(msg);
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
    // returns {onResponse, onError, onFinished, cancel}
    _makeRequestToNode = (nodeId, requestBody, opts) => {
        // Send a request to node
        const requestId = opts.requestId || randomString(10);
        const onResponseCallbacks = [];
        const onErrorCallbacks = [];
        const onFinishedCallbacks = [];
        // todo: think about doing this without a broadcast
        const message = {
            type: 'requestToNode', // todo: make sure we handle this
            toNodeId: nodeId,
            requestId,
            requestBody
        }
        this._sendMessageToKacheryPeer(nodeId, message); // todo: implement
        const listener = this._createKacheryPeerMessageListener((fromNodeId, msg) => {
            if (fromNodeId !== nodeId) return false;
            return ((
                (msg.type === 'requestToNodeResponse') ||
                (msg.type === 'requestToNodeError') ||
                (msg.type === 'requestToNodeFinished') ||
                (msg.type === 'requestToNodeReceived')
            ) && (msg.requestId === requestId));
        });
        let isFinished = false;
        let requestReceived = false;
        let timestampLastResponse = new Date();
        const handleReceived = () => {
            requestReceived = true;
        }
        const handleFinished = () => {
            if (isFinished) return;
            onFinishedCallbacks.forEach(cb => cb());
            isFinished = true;
            listener.cancel();
        }
        const handleResponse = (responseBody) => {
            if (isFinished) return;
            timestampLastResponse = new Date();
            onResponseCallbacks.forEach(cb => cb(responseBody));
        }
        const handleError = (errorString) => {
            if (isFinished) return;
            onErrorCallbacks.forEach(cb => cb(errorString));
            isFinished = true;
            listener.cancel();
        }

        if (opts.timeout) {
            const monitorTimeout = async () => {
                while (!isFinished) {
                    const elapsedSinceResponse = (new Date()) - timestampLastResponse;
                    if (elapsedSinceResponse > opts.timeout) {
                        handleError('Timeout while waiting for response.');
                    }
                    await sleepMsec(1000);
                }
            }
            monitorTimeout();
        }

        listener.onMessage((fromNodeId, msg) => {
            if (msg.type === 'requestToNodeReceived') {
                handleReceived();
            }
            else if (msg.type === 'requestToNodeResponse') {
                handleResponse(msg.responseBody);
            }
            else if (msg.type === 'requestToNodeError') {
                handleError(msg.errorString);
            }
            else if (msg.type === 'requestToNodeFinished') {
                handleFinished();
            }
        });
        return {
            requestId,
            onResponse: cb => onResponseCallbacks.push(cb),
            onError: cb => onErrorCallbacks.push(cb),
            onFinished: cb => onFinishedCallbacks.push(cb),
            // todo: think about doing more here - send out a cancel message to node
            cancel: () => {handleFinished(); listener.cancel();}
        }
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
    else if (k1.type === 'liveFeed') {
        return ((k1.type === k2.type) && (k1.feedId === k2.feedId));
    }
    else {
        return false;
    }
}

export default KacherySwarmConnection;