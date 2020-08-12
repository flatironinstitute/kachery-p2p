import fs from 'fs';
import { getSignature, verifySignature, hexToPublicKey, sha1sum, JSONStringifyDeterministic } from './common/crypto_util.js';
import { sleepMsec, randomAlphaString, sha1MatchesFileKey, readJsonFile } from './common/util.js';
import { getLocalFileInfo, moveFileIntoKacheryStorage, concatenateFilesIntoTemporaryFile } from './kachery.js';
import SmartyNode from './SmartyNode.js';
import { log } from './common/log.js';
import assert from 'assert';
import Stream from 'stream';
import SocketServer from './SocketServer.js';
import crypto from 'crypto';
import BootstrapPeerManager from './BootstrapPeerManager.js';
import RemoteNodeManager from './RemoteNodeManager.js';
import util from 'util';
import dgram from 'dgram';
import { protocolVersion } from './protocolVersion.js';
import { validateObject, validateChannelName, validateNodeId, validateNodeToNodeMessage, validateNodeData, validateSha1Hash, validatePort } from './schema/index.js';
import FileProvider from './download/FileProvider.js';
import FileLoader from './download/FileLoader.js';

const MAX_BYTES_PER_DOWNLOAD_REQUEST = 20e6;

class Node {
    constructor({
        nodeId,
        keyPair,
        address,
        port,
        udpAddress,
        udpPort,
        feedManager,
        label
    }) {
        log().info(`Starting kachery-p2p node`, { nodeId, address, port, udpAddress, udpPort, label });
        this._nodeId = nodeId;
        this._keyPair = keyPair;

        this._nodeInfo = {
            nodeId,
            address,
            port,
            udpAddress,
            udpPort,
            label
        }
        this._channels = {}; // {[channelName]: true}}

        this._feedManager = feedManager;
        this._handledBroadcastMessages = {};
        this._messageListeners = {}; // listeners for incoming messages
        this._halt = false;

        this._bootstrapPeerManagers = [];

        this._onProvidingCallbacks = [];
        this._onRequestCallbacks = [];

        this._remoteNodeManager = new RemoteNodeManager(this);
        this._remoteNodeManager.setLocalNodeInfo(this._nodeInfo);
        this._remoteNodeManager.onMessage(({fromNodeId, message}) => this._handleMessage({fromNodeId, message}));
        this._remoteNodeManager.setLocalNodeInfo(this._nodeInfo);

        this._activeIncomingRequests = {}; // by request id

        this._inProgressLoadFiles = {}; // by fileKeyCode

        this._smartyNode = new SmartyNode(this);

        this.onRequest(({channelName, fromNodeId, requestBody, sendResponse, reportError, reportFinished, onCanceled, onResponseReceived}) => {
            this._handleRequestFromNode({channelName, fromNodeId, requestBody, sendResponse, reportError, reportFinished, onCanceled, onResponseReceived});
        });

        // udp server
        this._udpServer = this._initializeServer({ type: 'udp', listenPort: this._nodeInfo.udpPort, onListen: () => {} });
        this._udpServer.onUdpPublicEndpointChanged(() => this._handleUdpPublicEndpointChanged());

        // websocket server
        this._websocketServer = this._initializeServer({ type: 'websocket', listenPort: this._nodeInfo.port, onListen: () => {
            this._start();
        }});
    }
    nodeId() {
        return this._nodeId;
    }
    nodeInfo() {
        return cloneObject(this._nodeInfo);
    }
    halt() {
        this._remoteNodeManager.halt();
        this._halt = true;
    }
    getPeerIdsForChannel(channelName) {
        validateChannelName(channelName);

        return this._remoteNodeManager.peerIdsForChannel(channelName);
    }
    getNodeIdsForChannel(channelName) {
        validateChannelName(channelName);

        return this._remoteNodeManager.remoteNodeIdsForChannel(channelName);
    }
    async addBootstrapPeer({address, port}) {
        validateObject(address, '/Address');
        validateObject(port, '/Port');
        this._bootstrapPeerManagers.push(
            new BootstrapPeerManager({remoteNodeManager: this._remoteNodeManager, websocketServer: this._websocketServer, address, port})
        );
    }
    onProviding(cb) {
        assert(typeof(cb) === 'function', 'onProviding callback is not a function');
        this._onProvidingCallbacks.push(cb);
    }
    broadcastMessage({ channelName, message }) {
        validateChannelName(channelName);
        assert(channelName in this._channels, 'Cannot broadcast message. Not in channel.');
        validateNodeToNodeMessage(message);

        const broadcastMessageId = randomAlphaString(10);
        const body = {
            channelName,
            broadcastMessageId,
            fromNodeId: this._nodeId,
            message,
            timestamp: (new Date()) - 0
        };
        const message2 = {
            type: 'broadcast',
            body,
            signature: getSignature(body, this._keyPair)
        };
        this._handleBroadcastMessage({ fromNodeId: this._nodeId, message: message2 });
    }
    joinChannel(channelName) {
        validateChannelName(channelName);

        log().info('Joining channel', { channelName });
        if (channelName in this._channels) {
            return;
        }
        this._channels[channelName] = true;
    }
    leaveChannel(channelName) {
        validateChannelName(channelName);

        log().info('Leaving channel', { channelName });
        if (channelName in this._channels) {
            delete this._channels[channelName];
        }
    }
    hasJoinedChannel(channelName) {
        validateChannelName(channelName);

        return (channelName in this._channels);
    }
    joinedChannelNames() {
        const ret = [];
        for (let k in this._channels) {
            ret.push(k);
        }
        return ret;
    }
    async sendMessageToNode({ channelName, toNodeId, direct=false, route, message }) {
        validateChannelName(channelName);
        assert(channelName in this._channels, `Not in channel: ${channelName}`);
        validateNodeId(toNodeId);
        // assert(typeof(direct) === 'boolean')
        if (route) {
            // assert(Array.isArray(route));
            for (let x of route) {
                validateNodeId(x);
            }
            if (direct) {
                throw Error('Cannot provide route with direct=true');
            }
        }
        validateNodeToNodeMessage(message);

        if ((!route) || (direct)) {
            //  check if we can send it directly to peer
            if (this._remoteNodeManager.isPeer(toNodeId)) {
                this._remoteNodeManager.sendMessageDirectlyToPeer(toNodeId, message);
                return;
            }
        }
        if ((!route) && (!direct)) {
            // check for a route unless we are forcing direct
            route = await this._smartyNode.which_route_should_i_use_to_send_a_message_to_this_node({ channelName, toNodeId, calculateIfNeeded: true })
            if (!route) {
                throw new NoRouteToNodeError({channelName, toNodeId});
            }
        }

        const body = {
            channelName,
            fromNodeId: this._nodeId,
            toNodeId,
            route,
            message,
            timestamp: (new Date()) - 0
        }
        const message2 = {
            type: 'messageToNode',
            body,
            signature: getSignature(body, this._keyPair)
        };
        this._handleMessageToNode({ fromNodeId: this._nodeId, message: message2 });
    }

    // Create a new listener for messages coming from a node
    // if testFunction({fromNodeId, msg}) returns true, it will call
    // the callbacks registered in ret.onMessage(...)
    // Cancel the listener via ret.cancel()
    createMessageListener(testFunction) {
        assert(typeof(testFunction) === 'function', 'testFunction is not a function.');

        const x = {
            name: randomAlphaString(10),
            testFunction,
            onMessageCallbacks: []
        };
        this._messageListeners[x.name] = x;
        return {
            onMessage: cb => { x.onMessageCallbacks.push(cb); },
            cancel: () => {
                delete this._messageListeners[x.name]
            }
        };
    }
    // Listen for requests and send responses
    // Note: it is possible to send more than one response before calling onFinished
    // .onRequest(({fromNodeId, requestBody, sendResponse, reportError, reportFinished})) => {...});
    onRequest(cb) {
        // assert(typeof(cb) === 'function');
        this._onRequestCallbacks.push(cb);
    }
    makeRequestToNode = ({ channelName, toNodeId, requestBody, direct=false, timeout, requestId }) => {
        validateChannelName(channelName);
        assert(channelName in this._channels, 'Cannot make request to node. Node in channel.');
        validateNodeId(toNodeId);
        validateObject(requestBody, '/RequestBody');
        timeout = timeout || null;
        requestId = requestId || randomAlphaString(10);
        assert(channelName in this._channels, `Not in channel: ${channelName}`);
        // assert(typeof(direct) === 'boolean');
        if (timeout !== null) {
            // assert(typeof(timeout) === 'number');
        }
        validateObject(requestId, '/MessageId');

        // Send a request to node
        const onResponseCallbacks = [];
        const onErrorCallbacks = [];
        const onFinishedCallbacks = [];

        const message = {
            type: 'requestToNode',
            channelName,
            requestId,
            requestBody
        }
        this.sendMessageToNode({ channelName, toNodeId, direct, route: null, message });
        const listener = this.createMessageListener(({ fromNodeId, message }) => {
            if (fromNodeId !== toNodeId) return false;
            return ((
                (message.type === 'requestToNodeResponse') ||
                (message.type === 'requestToNodeError') ||
                (message.type === 'requestToNodeFinished') ||
                (message.type === 'requestToNodeReceived')
            ) && (message.requestId === requestId));
        });
        let isFinished = false;
        let requestReceived = false;
        let timestampLastResponse = new Date();
        let lastResponseIndex = -1;
        let bufResponsesByIndex = {};
        const handleReceived = () => {
            requestReceived = true;
            timestampLastResponse = new Date(); // reset the timer
        }
        const handleFinished = () => {
            if (isFinished) return;
            onFinishedCallbacks.forEach(cb => cb());
            isFinished = true;
            listener.cancel();
        }
        const handleResponse = (responseBody) => {
            if (isFinished) return;
            timestampLastResponse = new Date(); // reset the timer

            onResponseCallbacks.forEach(cb => cb(responseBody));
        }
        const handleError = (errorString) => {
            if (isFinished) return;
            onErrorCallbacks.forEach(cb => cb(errorString));
            isFinished = true;
            listener.cancel();
        }
        listener.onMessage(async ({ fromNodeId, message }) => {
            if (message.type === 'requestToNodeReceived') {
                handleReceived();
            }
            else if (message.type === 'requestToNodeResponse') {
                const responseIndex = message.responseIndex;
                const receivedMessage = {
                    type: 'requestToNodeResponseReceived',
                    channelName,
                    requestId,
                    responseIndex
                }
                this.sendMessageToNode({ channelName, toNodeId, direct, route: null, message: receivedMessage });
                
                bufResponsesByIndex[responseIndex] = message.responseBody;
                while (bufResponsesByIndex[lastResponseIndex + 1]) {
                    handleResponse(bufResponsesByIndex[lastResponseIndex + 1]);
                    delete bufResponsesByIndex[lastResponseIndex + 1];
                    lastResponseIndex++;
                }
            }
            else if (message.type === 'requestToNodeError') {
                handleError(message.errorString);
            }
            else if (message.type === 'requestToNodeFinished') {
                // wait until we have received the expected number of responses
                while ((lastResponseIndex + 1 < message.numResponses) && (!isFinished)) {
                    await sleepMsec(10);
                }
                handleFinished();
            }
        });
        const _doCancel = () => {
            const cancelMessage = {
                type: 'cancelRequestToNode',
                channelName,
                requestId
            }
            // we should get an error message coming back
            this.sendMessageToNode({ channelName, toNodeId, direct, route: null, message: cancelMessage });
        }
        if (timeout) {
            const checkTimeout = () => {
                const elapsed = (new Date() - timestampLastResponse);
                if (elapsed > timeout) {
                    if (!isFinished) {
                        handleError('Timeout while waiting for response.');
                    }
                }
                else {
                    setTimeout(() => {
                        checkTimeout();
                    }, timeout - elapsed + 10);
                }
            }
            checkTimeout();
        }
        return {
            requestId,
            onResponse: cb => onResponseCallbacks.push(cb),
            onError: cb => onErrorCallbacks.push(cb),
            onFinished: cb => onFinishedCallbacks.push(cb),
            // todo: think about doing more here - send out a cancel message to node
            cancel: () => { _doCancel(); }
        }
    }
    _findFileOrLiveFeed = ({fileKey, timeoutMsec}) => {
        validateObject(fileKey, '/FileKey');
        // assert(typeof(timeoutMsec) === 'number');

        const findOutputs = [];
        const foundCallbacks = [];
        const finishedCallbacks = [];
        let isFinished = false;
        const handleCancel = () => {
            if (isFinished) return;
            for (let x of findOutputs) {
                x.cancel();
            }
            isFinished = true;
            finishedCallbacks.forEach(cb => cb());
        }
        const ret = {
            onFound: cb => {foundCallbacks.push(cb)},
            onFinished: cb => {finishedCallbacks.push(cb)},
            cancel: handleCancel
        };

        if (fileKey.type === 'liveFeed')
            log().info(`Finding live feed`, {fileKey});
        else
            log().info(`Finding file`, {fileKey});

        const channelNames = this.joinedChannelNames();
        channelNames.forEach(channelName => {
            const x = this._findFileOrLiveFeedOnChannel({channelName, fileKey, timeoutMsec});
            findOutputs.push(x);
            x.onFound(result => {
                if (isFinished) return;
                validateObject(result, '/FindFileOrLiveFeedResult');
                foundCallbacks.forEach(cb => cb(result));
            });
            x.onFinished(() => {x.finished=true; checkFinished();});
        });
        const checkFinished = () => {
            if (isFinished) return;
            for (let x of findOutputs) {
                if (!x.finished) return;
            }
            isFinished = true;
            finishedCallbacks.forEach(cb => cb());
        }
        checkFinished();
        return ret;
    }
    _findFileOrLiveFeedOnChannel = ({channelName, fileKey, timeoutMsec}) => {
        if ((timeoutMsec === undefined) || (timeoutMsec === null)) {
            timeoutMsec = 4000;
        }
        validateChannelName(channelName);
        assert(channelName in this._channels, `Not in channel: ${channelName}`);
        validateObject(fileKey, '/FileKey');
        assert(typeof(timeoutMsec) === 'number', 'timeoutMsec is not a number');

        const onFoundCallbacks = [];
        const onFinishedCallbacks = [];
        let isFinished = false;
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
        let transformedFileKey = _transformFileKey({fileKey, nodeId: this._nodeId});
        this.broadcastMessage({
            channelName,
            message: {
                type: 'seeking',
                channelName,
                fileKey: transformedFileKey
            }
        });
        this.onProviding((x) => { // todo: fix this memory leak
            if (isFinished) return;
            validateChannelName(x.channelName);
            validateNodeId(x.nodeId);
            validateObject(x.fileKey, '/FileKey');
            assert(x.channelName in this._channels, `Not in channel: ${x.channelName}`);
            if ((x.channelName === channelName) && (fileKeysMatch(x.fileKey, transformedFileKey))) {
                const result = {
                    channel: x.channelName,
                    nodeId: x.nodeId,
                    fileKey: x.fileKey,
                    fileSize: x.fileSize
                }
                validateObject(result, '/FindFileOrLiveFeedResult');
                onFoundCallbacks.forEach(cb => {cb(result);});
            }
        });
        setTimeout(() => {
            handleCancel();
        }, timeoutMsec);
        return ret;
    }
    _loadFileWithManifest({fileKey}) {
        validateObject(fileKey, '/FileKey');
        validateSha1Hash(fileKey.manifestSha1);

        const onFinishedCallbacks = [];
        const onErrorCallbacks = [];
        const onProgressCallbacks = [];

        let done = false;

        const _handleCancel = () => {
            _reportError(new Error('canceled'));
        }

        const _reportError = (err) => {
            if (done) return;
            done = true;
            onErrorCallbacks.forEach(cb => cb(err));
        }

        const _reportFinished = ({path}) => {
            if (done) return;
            done = true;
            onFinishedCallbacks.forEach(cb => cb({path}));
        }

        let bytesLoaded = 0;
        let progressTimer = new Date();

        (async () => {
            try {
                const manifestFileKey = {sha1: fileKey.manifestSha1};
                const manifestPath = await this._loadFileAsync({fileKey: manifestFileKey});
                const manifest = await readJsonFile(manifestPath);
                if (!sha1MatchesFileKey({sha1: manifest.sha1, fileKey})) {
                    throw new Error(`Manifest sha1 does not match file key: ${manifest.sha1}`);
                }
                const chunkPaths = [];
                let lastProg = {};
                for (let ichunk = 0; ichunk < manifest.chunks.length; ichunk++) {
                    if (done) return;
                    const chunk = manifest.chunks[ichunk];
                    console.info(`Loading chunk ${ichunk + 1} of ${manifest.chunks.length} (${chunk.end - chunk.start} bytes)`);
                    // todo: report progress here
                    const chunkFileKey = {
                        sha1: chunk.sha1,
                        chunkOf: {
                            fileKey: {
                                sha1: manifest.sha1
                            },
                            startByte: chunk.start,
                            endByte: chunk.end
                        }
                    };
                    const _handleChunkProgress = ((prog) => {
                        lastProg = prog;
                        const pr0 = {
                            bytesLoaded: bytesLoaded + prog.bytesLoaded,
                            bytesTotal: manifest.size,
                            nodeId: prog.nodeId
                        }
                        onProgressCallbacks.forEach(cb => cb(pr0));
                        progressTimer = new Date();
                    });
                    const chunkPath = await this._loadFileAsync({fileKey: chunkFileKey, onProgress: _handleChunkProgress});
                    bytesLoaded += chunk.end - chunk.start;
                    const pr = {
                        bytesLoaded,
                        bytesTotal: manifest.size,
                        nodeId: lastProg.nodeId || ''
                    }
                    const progressElapsed = (new Date()) - progressTimer;
                    if (progressElapsed >= 1000) {
                        onProgressCallbacks.forEach(cb => cb(pr));
                        progressTimer = new Date();
                    }
                    chunkPaths.push(chunkPath);                    
                }
                console.info(`Concatenating ${manifest.chunks.length} chunks.`);
                const {sha1, path: concatPath} = await concatenateFilesIntoTemporaryFile(chunkPaths);
                if (sha1 !== manifest.sha1) {
                    fs.unlinkSync(concatPath);
                    throw Error('Unexpected SHA-1 of concatenated file.');
                }
                moveFileIntoKacheryStorage({path: concatPath, sha1: manifest.sha1});
                _reportFinished({path: concatPath});
            }
            catch(err) {
                _reportError(err);
            }
        })();

        return {
            onProgress: cb => onProgressCallbacks.push(cb),
            onFinished: cb => onFinishedCallbacks.push(cb),
            onError: cb => onErrorCallbacks.push(cb),
            cancel: () => _handleCancel()
        }
    }
    async _loadFileAsync({fileKey, onProgress=undefined}) {
        validateObject(fileKey, '/FileKey');
        return new Promise((resolve, reject) => {
            const x = this.loadFile({fileKey});
            x.onFinished(({path}) => {
                resolve(path);
            });
            if (onProgress) {
                x.onProgress(prog => onProgress(prog));
            }
            x.onError(err => {
                reject(err);
            })
        });
    }
    loadFile({fileKey}) {
        validateObject(fileKey, '/FileKey');
        const fileKeyCode = sha1sum(JSONStringifyDeterministic(fileKey));
        if (fileKeyCode in this._inProgressLoadFiles) {
            const x = this._inProgressLoadFiles[fileKeyCode];
            x._internalData.numAttachedCallers++;
            return {
                onProgress: cb => x.onProgress(cb),
                onFinished: cb => x.onFinished(cb),
                onError: cb => x.onError(cb),
                cancel: () => x.cancel()
            };
        }

        let _internalData = {
            numAttachedCallers: 1
        };

        const onFinishedCallbacks = [];
        const onErrorCallbacks = [];
        const onProgressCallbacks = [];
        let finder = null;
        let fileLoader = null;
        let _handleCancel = () => { // this is replace below in the case of manifest chunks
            _internalData.numAttachedCallers--;
            if (_internalData.numAttachedCallers <= 0) {
                if (finder) finder.cancel();
                if (fileLoader) fileLoader.cancel();
                if (fileKeyCode in this._inProgressLoadFiles) {
                    delete this._inProgressLoadFiles[fileKeyCode];
                }
            }
        }

        const _handleFinished = (path) => {
            if (fileKeyCode in this._inProgressLoadFiles) {
                delete this._inProgressLoadFiles[fileKeyCode];
            }
            onFinishedCallbacks.forEach(cb => cb({path}));
        }
        const _handleError = (err) => {
            if (fileKeyCode in this._inProgressLoadFiles) {
                delete this._inProgressLoadFiles[fileKeyCode];
            }
            onErrorCallbacks.forEach(cb => cb(err));
        }
        const _handleProgress = (prog) => {
            onProgressCallbacks.forEach(cb => cb(prog));
        }
        

        (async () => {
            const fileInfo = await getLocalFileInfo({fileKey});
            if (fileInfo) {
                _handleFinished(fileInfo.path);
                return;
            }
            if (fileKey.manifestSha1) {
                const x = this._loadFileWithManifest({fileKey});
                x.onFinished(({path}) => _handleFinished(path));
                x.onError(err => _handleError(err));
                x.onProgress(prog => _handleProgress(prog));
                _handleCancel = () => x.cancel();
                return;
            }

            fileLoader = new FileLoader({fileKey});
            fileLoader.onProgress(prog => {
                _handleProgress(prog);
            });

            assert((fileKey.sha1) || (fileKey.transformedSha1), 'Incorrect type of fileKey.');
            finder = this._findFileOrLiveFeed({fileKey});
            finder.onFound(findFileResult => {
                validateObject(findFileResult, '/FindFileOrLiveFeedResult');
                const provider = new FileProvider({node: this, findFileResult});
                fileLoader.addFileProvider(provider);
            });
            finder.onFinished(() => {
                fileLoader.reportFinishedFindingProviders();
            });

            fileLoader.onFinished(({path}) => {
                finder.cancel();
                _handleFinished(path);
            });
            fileLoader.onError((err) => {
                finder.cancel();

                _handleError(err);
            });
        })();

        const ret = {
            onProgress: cb => onProgressCallbacks.push(cb),
            onFinished: cb => onFinishedCallbacks.push(cb),
            onError: cb => onErrorCallbacks.push(cb),
            cancel: () => _handleCancel(),
            _internalData
        };
        this._inProgressLoadFiles[fileKeyCode] = ret;

        return ret;
    }
    downloadFile({channelName, nodeId, fileKey, startByte, endByte}) {
        validateChannelName(channelName);
        assert(channelName in this._channels, `Not in channel: ${channelName}`);
        validateNodeId(nodeId);
        validateObject(fileKey, '/FileKey');
        // assert(typeof(startByte) === 'number');
        // assert(typeof(endByte) === 'number');

        const numBytes = endByte - startByte;

        // split into chunks so that we won't have a memory overflow
        const chunkSize = 4 * 1000 * 1000;
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
        const _handleCancel = (errorString) => {
            if (_cancelled) return;
            _cancelled = true;
            if (_currentReq) {
                _currentReq.cancel();
            }
            stream.destroy(new Error(errorString));
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
        
                const req = this.makeRequestToNode({channelName, toNodeId: nodeId, requestBody, timeout: 10000});
                _currentReq = req;
                req.onResponse(responseBody => {
                    if (finished) return;
                    if (!responseBody.data_b64) {
                        finished = true;
                        reject('Error downloading file. No data in response');
                        return;
                    }
                    try {
                        const buf = Buffer.from(responseBody.data_b64, 'base64');
                        // const buf = responseBody.data;
                        sha1_sum.update(buf);
                        // todo: implement this properly so we don't overflow the stream
                        bytesDownloadedThisChunk += buf.length;
                        stream.push(buf);
                        streamState.readyToWrite = false;
                    }
                    catch(err) {
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
                        const errstr = `Problem in downloadChunks: ${err.message}`;
                        _handleCancel(errstr);
                        return;
                    }
                }
            }
            // todo: check the sha1_sum here (if not cancelled)
            stream.push(null);
        }
        downloadChunks();
        return {
            stream,
            cancel: () => _handleCancel('DownloadCanceled')
        };
    }
    async getLiveFeedSignedMessages({channelName, nodeId, feedId, subfeedName, position, waitMsec}) {
        validateChannelName(channelName);
        assert(channelName in this._channels, 'Cannot getLiveFeedSignedMessages. Not in channel.');
        validateNodeId(nodeId);
        validateObject(feedId, '/FeedId');
        validateObject(subfeedName, '/SubfeedName');
        // assert(typeof(position) === 'number');
        // assert(typeof(waitMsec) === 'number');

        return new Promise((resolve, reject) => {
            const requestBody = {
                type: 'getLiveFeedSignedMessages',
                feedId,
                subfeedName,
                position,
                waitMsec
            };
            let finished = false;
            const signedMessages = [];
            const req = this.makeRequestToNode({channelName, toNodeId: nodeId, requestBody, timeout: waitMsec + 10000});
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

    async submitMessagesToLiveFeed({channelName, nodeId, feedId, subfeedName, messages}) {
        validateChannelName(channelName);
        assert(channelName in this._channels, 'Cannot submit messages to live feed. Not in channel.');
        validateNodeId(nodeId);
        validateObject(feedId, '/FeedId');
        validateObject(subfeedName, '/SubfeedName');
        // assert(Array.isArray(messages));

        return new Promise((resolve, reject) => {
            const requestBody = {
                type: 'submitMessagesToLiveFeed',
                feedId,
                subfeedName,
                messages
            };
            let finished = false;
            const req = this.makeRequestToNode({channelName, toNodeId: nodeId, requestBody, timeout: 10000});
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

    _handleRequestFromNode({channelName, fromNodeId, requestBody, sendResponse, reportError, reportFinished, onCanceled, onResponseReceived}) {
        validateChannelName(channelName);
        assert(channelName in this._channels, `Not in channel: ${channelName}`);
        validateNodeId(fromNodeId);
        validateObject(requestBody, '/RequestBody');
        assert(typeof(sendResponse) === 'function', 'sendResponse is not a function.');
        assert(typeof(reportError) === 'function', 'reportError is not a function.');
        assert(typeof(reportFinished) === 'function', 'reportFinished is not a function.');
        assert(typeof(onCanceled) === 'function', 'onCanceled is not a function.');
        assert(typeof(onResponseReceived) === 'function', 'onResponseReceived is not a function.');

        if (requestBody.type === 'downloadFile') {
            this._handleDownloadFileRequest({
                channelName, fromNodeId, requestBody, sendResponse, reportError, reportFinished, onCanceled, onResponseReceived
            })
        }
        else if (requestBody.type === 'getLiveFeedSignedMessages') {
            this._handleGetLiveFeedSignedMessages({
                channelName, fromNodeId, requestBody, sendResponse, reportError, reportFinished, onCanceled, onResponseReceived
            })
        }
        else if (requestBody.type === 'submitMessagesToLiveFeed') {
            this._handleSubmitMessagesToLiveFeed({
                channelName, fromNodeId, requestBody, sendResponse, reportError, reportFinished, onCanceled, onResponseReceived
            })
        }
    }

    _handleUdpPublicEndpointChanged() {
        const remote = this._udpServer.udpPublicEndpoint();
        if (remote) {
            if ((remote.address !== this._nodeInfo.udpAddress) || (remote.port !== this._nodeInfo.udpPort)) {
                console.info('Setting udp public endpoint', remote);
                this._nodeInfo.udpAddress = remote.address || null;
                this._nodeInfo.udpPort = remote.port || null;
                this._remoteNodeManager.setLocalNodeInfo(this._nodeInfo);
            }
        }
    }

    _announceSelfToPeersAndJoinedChannelsNow() {
        const message = {
            type: 'announcing',
            nodeData: this._createNodeData()
        };
        validateObject(message, '/AnnouncingMessage');
        for (let channelName in this._channels) {
            this.broadcastMessage({channelName, message});
        }
        this._remoteNodeManager.sendMessageToAllPeersNotInJoinedChannels(message);
    }

    async _hasRouteToNode({channelName, toNodeId}) {
        validateChannelName(channelName);
        validateNodeId(toNodeId);

        const route = await this._smartyNode.which_route_should_i_use_to_send_a_message_to_this_node({ channelName, toNodeId, calculateIfNeeded: true });
        return route ? true : false;
    }

    async _getInfoText() {
        const makeNodeLine = async ({channelName, nodeId, nodeInfo}) => {
            const ni = nodeInfo || {};
            const hasIn = this._remoteNodeManager.peerHasConnectionOfType(nodeId, {type: 'websocket', direction: 'incoming'});
            const hasOut = this._remoteNodeManager.peerHasConnectionOfType(nodeId, {type: 'websocket', direction: 'outgoing'});
            const hasUdpIn = this._remoteNodeManager.peerHasConnectionOfType(nodeId, {type: 'udp', direction: 'incoming'});
            const hasUdpOut = this._remoteNodeManager.peerHasConnectionOfType(nodeId, {type: 'udp', direction: 'outgoing'});
            const bootstrap = this._remoteNodeManager.peerIsBootstrap(nodeId);
            const isLocal = this._remoteNodeManager.remoteNodeHasLocalAddress(nodeId);
            const hasUdpAddress = (ni.udpAddress && ni.udpPort);

            if (bootstrap) {
                ni.address = this._remoteNodeManager.bootstrapPeerInfo(nodeId).address;
                ni.port = this._remoteNodeManager.bootstrapPeerInfo(nodeId).port;
            }

            let hasRoute = null;
            if ((!hasIn) && (!hasOut) && (!hasUdpIn) && (!hasUdpOut)) {
                hasRoute = channelName ? await this._hasRouteToNode({channelName, toNodeId: nodeId}) : false;
            }
            const items = [];
            if (bootstrap) items.push('bootstrap');
            if (hasIn) items.push('in');
            if (hasOut) items.push('out');
            if (hasUdpIn) items.push('udp-in');
            if (hasUdpOut) items.push('udp-out');
            if (hasRoute) items.push('route');
            if (isLocal) items.push('local');
            return `Node${hasUdpAddress ? '*' : ''} ${nodeId.slice(0, 6)}... ${ni.label || ''}: ${ni.address || ""}:${ni.port || ""} ${items.join(' ')}`;
        }

        const sortByConnectivity = (nodeIds) => {
            const mm = this._remoteNodeManager;
            return nodeIds.sort((n1, n2) => {
                const i1 = mm.peerIsBootstrap(n1) * 1000 + mm.peerHasConnectionOfType(n1, {type: 'websocket'}) * 100 + mm.peerHasConnectionOfType(n1, {type: 'udp'}) * 10;
                const i2 = mm.peerIsBootstrap(n2) * 1000 + mm.peerHasConnectionOfType(n2, {type: 'websocket'}) * 100 + mm.peerHasConnectionOfType(n2, {type: 'udp'}) * 10;
                return (i1 < i2) ? 1 : ((i1 > i2) ? -1 : 0);
            })
        }

        const lines = [];
        lines.push(`PROTOCOL VERSION: ${protocolVersion()}`)
        lines.push('');
        const nodesIncluded = {};
        const selfHasUdpAddress = ((this._nodeInfo.udpAddress) && (this._nodeInfo.udpPort));
        const maxToDisplay = 12;
        for (let channelName in this._channels) {
            const nodeIdsInChannel = sortByConnectivity(this.getNodeIdsForChannel(channelName));
            lines.push(`CHANNEL: ${channelName} (${nodeIdsInChannel.length + 1} ${(nodeIdsInChannel.length + 1 === 1) ? "node": "nodes"})`);
            lines.push(`self${selfHasUdpAddress ? '*' : ''} ${this._nodeId.slice(0, 6)}`);
            for (let ii = 0; ii < nodeIdsInChannel.length; ii ++) {
                const nodeId = nodeIdsInChannel[ii];
                nodesIncluded[nodeId] = true;
                if (ii < maxToDisplay) {
                    const nodeInfo = this._remoteNodeManager.remoteNodeInfo(nodeId);
                    lines.push(await makeNodeLine({channelName, nodeId, nodeInfo}));
                }
            }
            if (nodeIdsInChannel.length > maxToDisplay) {
                lines.push(`... and ${nodeIdsInChannel.length - maxToDisplay} others`)
            }
            lines.push('');
        }
        lines.push('OTHER');
        lines.push(`self${selfHasUdpAddress ? '*' : ''} ${this._nodeId.slice(0, 6)}`);
        const otherPeerIds = sortByConnectivity(this._remoteNodeManager.peerIds().filter(nodeId => (!nodesIncluded[nodeId])));
        for (let ii = 0; ii < otherPeerIds.length; ii ++) {
            const nodeId = otherPeerIds[ii];
            if (ii < maxToDisplay) {
                const nodeInfo = this._remoteNodeManager.remoteNodeInfo(nodeId);
                lines.push(await makeNodeLine({channelName: null, nodeId, nodeInfo}));
            }
        }
        if (otherPeerIds.length > maxToDisplay) {
            lines.push(`... and ${otherPeerIds.length - maxToDisplay} others`)
        }
        
        return lines.join('\n');
    }

    async _handleDownloadFileRequest({channelName, fromNodeId, requestBody, sendResponse, reportError, reportFinished, onCanceled, onResponseReceived}) {
        validateChannelName(channelName);
        assert(channelName in this._channels, `Not in channel: ${channelName}`);
        validateNodeId(fromNodeId);
        validateObject(requestBody, '/DownloadFileRequest');
        assert(typeof(sendResponse) === 'function', 'sendResponse is not a function.');
        assert(typeof(reportError) === 'function', 'reportError is not a function.');
        assert(typeof(reportFinished) === 'function', 'reportFinished is not a function.');
        assert(typeof(onCanceled) === 'function', 'onCanceled is not a function.');
        assert(typeof(onResponseReceived) === 'function', 'onResponseReceived is not a function.');

        const fileInfo = await getLocalFileInfo({fileKey: requestBody.fileKey});

        if (!fileInfo) {
            if (requestBody.fileKey.chunkOf) {
                validateObject(requestBody.fileKey.chunkOf, '/ChunkOf');
                validateObject(requestBody.fileKey.chunkOf.fileKey, '/FileKey');
                const fileInfo2 = await getLocalFileInfo({fileKey: requestBody.fileKey.chunkOf.fileKey});
                if (!fileInfo2) {
                    reportError('Unable to find file.');
                    return;
                }
                const requestBody2 = {
                    ...requestBody,
                    fileKey: requestBody.fileKey.chunkOf.fileKey,
                    startByte: requestBody.startByte + requestBody.fileKey.chunkOf.startByte,
                    endByte: requestBody.endByte + requestBody.fileKey.chunkOf.startByte
                }

                return await this._handleDownloadFileRequest({
                    channelName,
                    fromNodeId,
                    requestBody: requestBody2,
                    sendResponse,
                    reportError,
                    reportFinished,
                    onCanceled,
                    onResponseReceived
                });
            }
            else {
                reportError('Unable to find file.');
                return;
            }
        }

        const startByte = requestBody.startByte;
        const endByte = requestBody.endByte;
        if ((startByte === undefined) || (endByte === undefined) || (typeof(startByte) !== 'number') || (typeof(endByte) !== 'number')) {
            reportError('Missing or incorrect fields in request: startByte, endByte.');
            return;
        }
        if (endByte <= startByte) {
            reportError(`Expected startByte < endByte, but got: ${startByte} ${endByte}`);
            return;
        }
        const numBytes = endByte - startByte;
        if (numBytes > MAX_BYTES_PER_DOWNLOAD_REQUEST) {
            reportError(`Too many bytes in single download request: ${numBytes} > ${MAX_BYTES_PER_DOWNLOAD_REQUEST}`);
            return;
        }
        const fileSystemPath = fileInfo['path'];

        let numResponsesReceived = 0;
        let numResponsesSent = 0;
        let canceled = false;
        onResponseReceived((responseIndex) => {
            numResponsesReceived ++;
        });
        onCanceled(() => {
            canceled = true;
        });

        const AA = 35;
        const BB = 5000;

        const asyncOpen = util.promisify(fs.open);
        const asyncRead = util.promisify(fs.read);

        const file = await asyncOpen(fileSystemPath);

        // this process is way more efficient if this is large
        // but udp messages may have a problem
        const messageChunkSize = 300000;

        let i = requestBody.startByte;
        const buffer = Buffer.alloc(messageChunkSize);
        const timer0 = new Date();
        const tot = [0, 0, 0];
        let ttt;
        while ( i < requestBody.endByte) {
            ttt = new Date();
            if (canceled) {
                reportError('Download canceled by requester.');
                return;
            }
            if (numResponsesSent - numResponsesReceived > AA) {
                let timer0 = new Date();
                await sleepMsec(1);
                while ((numResponsesSent - numResponsesReceived > AA) && (!canceled)) {
                    const elapsed0 = (new Date()) - timer0;
                    if (elapsed0 > BB) {
                        reportError('Timeout while waiting for confirmation of receipt of messages.')
                        return;
                    }
                    await sleepMsec(1);
                }
            }
            const i1 = i;
            const i2 = Math.min(i1 + messageChunkSize, requestBody.endByte);
            tot[0] += (new Date()) - ttt;
            ttt = new Date();
            const x = await asyncRead(file, buffer, 0, i2 - i1, i1);
            if (x.bytesRead !== i2 - i1) {
                throw Error('Problem reading file. Unexpected number of bytes read.');
            }

            tot[1] += (new Date()) - ttt;
            ttt = new Date();
            sendResponse({
                data_b64: buffer.slice(0, i2 - i1).toString('base64')
            });
            // sendResponse({
            //     data: buffer.slice(0, i2 - i1)
            // });
            tot[2] += (new Date()) - ttt;
            numResponsesSent ++;

            i = i2;
        }
        while ((numResponsesSent - numResponsesReceived > 0) && (!canceled)) {
            await sleepMsec(20);
        }
        const elapsed = (new Date()) - timer0;
        reportFinished();
    }
    async _handleGetLiveFeedSignedMessages({channelName, fromNodeId, requestBody, sendResponse, reportError, reportFinished, onCanceled, onResponseReceived}) {
        validateChannelName(channelName);
        assert(channelName in this._channels, `Not in channel: ${channelName}`);
        validateNodeId(fromNodeId);
        validateObject(requestBody, '/GetLiveFeedSignedMessagesRequest');
        assert(typeof(sendResponse) === 'function', 'sendResponse is not a function.');
        assert(typeof(reportError) === 'function', 'reportError is not a function.');
        assert(typeof(reportFinished) === 'function', 'reportFinished is not a function.');
        assert(typeof(onCanceled) === 'function', 'onCanceled is not a function.');
        assert(typeof(onResponseReceived) === 'function', 'onResponseReceived is not a function.');

        const {feedId, subfeedName, position, waitMsec} = requestBody;
        validateObject(feedId, '/FeedId');
        validateObject(subfeedName, '/SubfeedName');
        // assert(typeof(position) === 'number');
        // assert(typeof(waitMsec) === 'number');
        let signedMessages;
        try {
            signedMessages = await this._feedManager.getSignedMessages({
                feedId, subfeedName, position, maxNumMessages: 10, waitMsec
            });
        }
        catch(err) {
            reportError(`Error getting signed messages: ${err.message}`);
            return;
        }
        sendResponse({
            signedMessages
        });
        reportFinished();
    }
    async _handleSubmitMessagesToLiveFeed({channelName, fromNodeId, requestBody, sendResponse, reportError, reportFinished, onCanceled, onResponseReceived}) {
        validateChannelName(channelName);
        assert(channelName in this._channels, `Not in channel: ${channelName}`);
        validateNodeId(fromNodeId);
        assert(typeof(sendResponse) === 'function', 'sendResponse is not a function');
        assert(typeof(reportError) === 'function', 'reportError is not a function');
        assert(typeof(reportFinished) === 'function', 'reportFinished is not a function');
        assert(typeof(onCanceled) === 'function', 'onCanceled is not a function');
        assert(typeof(onResponseReceived) === 'function', 'onResponseReceived is not a function');
        
        validateObject(requestBody, '/SubmitMessagesToLiveFeedRequest');

        const {feedId, subfeedName, messages} = requestBody;
        validateObject(feedId, '/FeedId');
        validateObject(subfeedName, '/SubfeedName');
        // assert(Array.isArray(messages));
        try {
            await this._feedManager._submitMessagesToLiveFeedFromRemoteNode({
                fromNodeId, feedId, subfeedName, messages
            });
        }
        catch(err) {
            reportError(`Error submitting messages: ${err.message}`);
            return;
        }
        // mo response needed
        reportFinished();
    }

    _initializeServer({ type, listenPort, onListen }) {
        assert(['websocket', 'udp'].includes(type), 'Invalid connection type.');
        validatePort(listenPort);
        assert(typeof(onListen) === 'function', 'onListen is not a function.');

        let X;
        if (type === 'websocket') {
            X = new SocketServer({ nodeId: this._nodeId, keyPair: this._keyPair, onListen });
        }
        else if (type === 'udp') {
            X = new SocketServer({ nodeId: this._nodeId, keyPair: this._keyPair, useUdp: true });
        }
        else {
            throw new UnexpectedInternalError(`Unexpected type: ${type}`)
        }

        X.onIncomingConnection(connection => {
            const nodeId = connection.remoteNodeId();
            validateNodeId(nodeId);
            try {
                this._remoteNodeManager.setIncomingConnection({nodeId, type, connection});
            }
            catch(err) {
                console.warn(`Failed to handle incoming connection. Disconnecting. (${err.message})`);
                connection.disconnect();
            }
        });

        X.listen(listenPort);

        return X;
    }

    _handleMessage({ fromNodeId, message }) {
        validateNodeId(fromNodeId);
        validateNodeToNodeMessage(message);

        if (message.type === 'announcing') {
            this._handleAnnouncingMessage({ fromNodeId, message });
        }
        else if (message.type === 'broadcast') {
            this._handleBroadcastMessage({ fromNodeId, message });
        }
        else if (message.type === 'cancelRequestToNode') {
            this._handleCancelRequestToNode({ fromNodeId, message });
        }
        else if (message.type === 'findChannelPeers') {
            this._handleFindChannelPeers({ fromNodeId, message });
        }
        else if (message.type === 'findChannelPeersResponse') {
            this._handleFindChannelPeersResponse({ fromNodeId, message });
        }
        else if (message.type === 'messageToNode') {
            this._handleMessageToNode({ fromNodeId, message });
        }
        else if (message.type === 'providing') {
            this._handleProvidingMessage({ fromNodeId, message });
        }
        else if (message.type === 'requestToNode') {
            this._handleRequestToNode({ fromNodeId, message });
        }
        else if (message.type === 'requestToNodeResponseReceived') {
            this._handleRequestToNodeResponseReceived({ fromNodeId, message });
        }
        else if (message.type === 'seeking') {
            this._handleSeekingMessage({ fromNodeId, message });
        }
        else {
            for (let name in this._messageListeners) {
                const x = this._messageListeners[name];
                if (x.testFunction({ fromNodeId, message })) {
                    x.onMessageCallbacks.forEach(cb => {
                        cb({ fromNodeId, message });
                    });
                }
            }
        }
    }

    _handleBroadcastMessage({ fromNodeId, message }) {
        validateNodeId(fromNodeId);
        validateObject(message, '/BroadcastMessage');

        const body = message.body;
        
        const broadcastMessageId = body.broadcastMessageId
        validateObject(broadcastMessageId, '/MessageId');

        if (this._handledBroadcastMessages[broadcastMessageId]) {
            return;
        }
        // todo: fix this memory leak
        this._handledBroadcastMessages[broadcastMessageId] = true;

        const channelName = body.channelName;
        if (!(channelName in this._channels)) {
            // if we aren't in the channel, then we aren't going to broadcast the message
            console.warn(`Not broadcasting message. Not in channel: ${channelName}`);
            return;
        }

        validateNodeId(body.fromNodeId);
        validateNodeToNodeMessage(body.message);

        const signature = message.signature;
        if (!verifySignature(body, signature, hexToPublicKey(body.fromNodeId), {checkTimestamp: true})) {
            throw new SignatureError({fromNodeId: body.fromNodeId});
        }
        if (fromNodeId !== this._nodeId) {
            // don't handle it ourselves if we are the ones sending it.
            this._handleMessage({ fromNodeId: body.fromNodeId, message: body.message })
        }
        const peerIdsInChannel = this.getPeerIdsForChannel(channelName);
        for (let peerId of peerIdsInChannel) {
            if (peerId !== fromNodeId) {
                this._remoteNodeManager.sendMessageDirectlyToPeer(peerId, message);
            }
        }
    }
    _handleMessageToNode({ fromNodeId, message }) {
        validateNodeId(fromNodeId);
        validateObject(message, '/MessageToNodeMessage');

        const body = message.body;
        const channelName = body.channelName;

        validateNodeId(body.fromNodeId);
        validateNodeId(body.toNodeId);
        validateNodeToNodeMessage(body.message);

        if (!(channelName in this._channels)) {
            // if we aren't in the channel, then we aren't going to send the message to the node
            console.warn(`Not sending message to node. Not in channel: ${channelName}`);
            return;
        }

        const signature = message.signature;
        if (!verifySignature(body, signature, hexToPublicKey(body.fromNodeId), {checkTimestamp: true})) {
            throw new SignatureError({fromNodeId: body.fromNodeId});
        }
        if (body.toNodeId === this._nodeId) {
            this._handleMessage({ channelName, fromNodeId: body.fromNodeId, message: body.message });
            return;
        }
        else if (body.route) {
            let index = body.route.indexOf(this._nodeId);
            if (index < 0) {
                throw new RouteError('Node not found in route');
            }
            if (index === (body.route.length - 1)) {
                throw new RouteError('Final node in route is not toNodeId');
            }
            const nextNodeId = body.route[index + 1];
            if (this._remoteNodeManager.isPeer(nextNodeId)) {
                this._remoteNodeManager.sendMessageDirectlyToPeer(nextNodeId, message);
            }
            else {
                throw new RouteError('Node that is next in the route is not a peer.');
            }
        }
        else {
            throw new RouteError(`No route in message to node.`);
        }
    }
    _handleCancelRequestToNode({ fromNodeId, message }) {
        validateNodeId(fromNodeId);
        validateObject(message, '/CancelRequestToNodeMessage');
        const requestId = message.requestId;
        validateObject(requestId, '/MessageId');

        if (requestId in this._activeIncomingRequests) {
            this._activeIncomingRequests[requestId].onCanceledCallbacks.forEach(cb => cb());
        }
    }
    _handleRequestToNodeResponseReceived({ fromNodeId, message }) {
        validateNodeId(fromNodeId);
        validateObject(message, '/RequestToNodeResponseReceivedMessage');
        const requestId = message.requestId;
        validateObject(requestId, '/MessageId');
        const responseIndex = message.responseIndex;
        assert(typeof(responseIndex) === 'number', 'responseIndex is not a number');

        if (requestId in this._activeIncomingRequests) {
            this._activeIncomingRequests[requestId].onResponseReceivedCallbacks.forEach(cb => cb(responseIndex));
        }
    }
    _handleRequestToNode({ fromNodeId, message }) {
        validateNodeId(fromNodeId);
        validateObject(message, '/RequestToNodeMessage');

        const requestId = message.requestId;
        const requestBody = message.requestBody;
        const channelName = message.channelName;

        validateObject(requestId, '/MessageId');
        validateObject(requestBody, '/RequestBody');
        assert(channelName in this._channels, `Not in channel: ${channelName}`);

        let numResponses = 0;
        this.sendMessageToNode({ channelName, toNodeId: fromNodeId, message: { type: 'requestToNodeReceived', requestId } });
        this._activeIncomingRequests[requestId] = {
            onCanceledCallbacks: [],
            onResponseReceivedCallbacks: []
        };
        this._onRequestCallbacks.forEach(cb => {
            cb({
                channelName,
                fromNodeId,
                requestId,
                requestBody,
                onCanceled: (cb) => {
                    this._activeIncomingRequests[requestId].onCanceledCallbacks.push(cb)
                },
                onResponseReceived: (cb) => {
                    this._activeIncomingRequests[requestId].onResponseReceivedCallbacks.push(cb)
                },
                sendResponse: responseBody => {
                    validateObject(responseBody, '/ResponseBody');
                    this.sendMessageToNode({ channelName, toNodeId: fromNodeId, message: { type: 'requestToNodeResponse', requestId, responseBody, responseIndex: numResponses } });
                    numResponses++;
                    return numResponses - 1;
                },
                reportError: errorString => {
                    assert(typeof(errorString) === 'string', 'errorString is not a string.');
                    this.sendMessageToNode({ channelName, toNodeId: fromNodeId, message: { type: 'requestToNodeError', requestId, errorString } });
                    if (requestId in this._activeIncomingRequests) {
                        delete this._activeIncomingRequests[requestId];
                    }
                },
                reportFinished: () => {
                    this.sendMessageToNode({ channelName, toNodeId: fromNodeId, message: { type: 'requestToNodeFinished', numResponses, requestId } });
                    if (requestId in this._activeIncomingRequests) {
                        delete this._activeIncomingRequests[requestId];
                    }
                }
            })
        });
    }
    async _handleSeekingMessage({ fromNodeId, message }) {
        validateNodeId(fromNodeId);
        validateObject(message, '/SeekingMessage');
        const fileKey = message.fileKey;
        const channelName = message.channelName;
        validateObject(fileKey, '/FileKey');
        assert(channelName in this._channels, `Not in channel: ${channelName}`);
        if (fileKey.transformedSha1) {
            // this is important
            assert(fileKey.transformNodeId === fromNodeId, 'transformNodeId is not fromNodeId');
        }
        if ((fileKey.sha1) || (fileKey.transformedSha1)) {
            const fileInfo = await getLocalFileInfo({ fileKey });
            if (fileInfo) {
                const message2 = {
                    type: 'providing',
                    channelName,
                    fileKey,
                    fileSize: fileInfo.size
                };
                this.sendMessageToNode({ channelName, toNodeId: fromNodeId, message: message2 });
            }
            else if (fileKey.chunkOf) {
                validateObject(fileKey.chunkOf, '/ChunkOf');
                validateObject(fileKey.chunkOf.fileKey, '/FileKey');
                const fileInfo2 = await getLocalFileInfo({fileKey: fileKey.chunkOf.fileKey});
                if (fileInfo2) {
                    const message2 = {
                        type: 'providing',
                        channelName,
                        fileKey,
                        fileSize: fileKey.chunkOf.endByte - fileKey.chunkOf.startByte
                    };
                    this.sendMessageToNode({ channelName, toNodeId: fromNodeId, message: message2 });
                }
            }
        }
        else if ((fileKey.feedId) || (fileKey.transformedFeedId)) {
            if (fileKey.feedId) validateObject(fileKey.feedId, '/FeedId');
            if (fileKey.transformedFeedId) validateSha1Hash(fileKey.transformedFeedId);
            let feedId;
            if (fileKey.feedId) {
                feedId = fileKey.feedId
            }
            else {
                // assert(fileKey.transformedFeedId)
                // assert(fileKey.transformNodeId);
                // assert(fileKey.feedIdHead);
                feedId = await this._feedManager.findFeedIdFromTransformedFeedId({ transformedFeedId: fileKey.transformedFeedId, transformNodeId: fileKey.transformNodeId, feedIdHead: fileKey.feedIdHead });
                if (!feedId) {
                    return;
                }
            }
            if (await this._feedManager.hasWriteableFeed({ feedId })) {
                const message2 = {
                    type: 'providing',
                    channelName,
                    fileKey
                }
                this.sendMessageToNode({ channelName, toNodeId: fromNodeId, message: message2 });
            }
        }
    }
    async _handleProvidingMessage({ fromNodeId, message }) {
        validateNodeId(fromNodeId);
        validateObject(message, '/ProvidingMessage');
        const fileKey = message.fileKey;
        const fileSize = message.fileSize || null;
        const channelName = message.channelName;

        validateObject(fileKey, '/FileKey');
        assert(channelName in this._channels, `Not in channel: ${channelName}`);

        this._onProvidingCallbacks.forEach(cb => {
            cb({ channelName, nodeId: fromNodeId, fileKey, fileSize });
        });
    }
    async _handleAnnouncingMessage({ fromNodeId, message }) {
        // one of two mechanisms to discover nodes and get updated info
        validateObject(message, '/AnnouncingMessage');
        validateObject(fromNodeId, '/NodeId');
        assert(message.nodeData.body.nodeInfo.nodeId === fromNodeId, 'Mismatch in node id');
        const transformedChannelNames = message.nodeData.body.transformedChannelNames;

        const data0 = message.nodeData;
        this._remoteNodeManager.setRemoteNodeData(fromNodeId, data0);
        if ((message.localAddress) && (message.localPort)) {
            this._remoteNodeManager.setRemoteNodeLocalAddress(fromNodeId, {localAddress: message.localAddress, localPort: message.localPort});
        }
        for (let transformedChannelName of transformedChannelNames) {
            for (let channelName in this._channels) {
                if (this._gettransformedChannelNameForAnnounce({channelName, nodeId: fromNodeId}) === transformedChannelName) {
                    const transformedChannelName2 = this._gettransformedChannelNameForDiscovery({channelName, nodeId: this._nodeId});
                    this._remoteNodeManager.associateNodeWithTransformedChannelName({nodeId: fromNodeId, transformedChannelName: transformedChannelName2});
                }
            }
        }
    }
    _createNodeData() {
        // This info gets advertized on the network
        const channelNames = Object.keys(this._channels);
        const transformedChannelNames = channelNames.map(channelName => (this._gettransformedChannelNameForAnnounce({channelName, nodeId: this._nodeId})));
        const body = {
            nodeInfo: this.nodeInfo(),
            transformedChannelNames,
            timestamp: (new Date()) - 0 // this is how nodes know what is the most up-to-date info. It's okay if the clocks are out of sync somehow.
        };
        return {
            body,
            signature: getSignature(body, this._keyPair)
        };
    }
    _handleFindChannelPeers({ fromNodeId, message }) {
        validateNodeId(fromNodeId);
        validateObject(message, '/FindChannelPeersMessage');

        const transformedChannelName = message.transformedChannelName;
        validateSha1Hash(transformedChannelName);

        const data = message.nodeData;
        validateNodeData(data);
        assert(fromNodeId === data.body.nodeInfo.nodeId, 'Mismatch with node id');
        assert(data.body.timestamp, 'Missing timestamp');

        if (!verifySignature(data.body, data.signature, hexToPublicKey(fromNodeId))) {
            throw new SignatureError({fromNodeId});
        }
        
        if (!this._remoteNodeManager.isPeer(fromNodeId)) {
            throw new Error('findChannelPeers must come from peer.');
        }
        this._remoteNodeManager.setRemoteNodeData(fromNodeId, data);
        this._remoteNodeManager.associateNodeWithTransformedChannelName({nodeId: fromNodeId, transformedChannelName});
        const nodeIds = this._remoteNodeManager.getNodeIdsForTransformedChannelName(transformedChannelName);
        const nodes = [];
        for (let nodeId of nodeIds) {
            if (nodeId !== fromNodeId) {
                const data0 = this._remoteNodeManager.remoteNodeData(nodeId);
                if (data0) {
                    nodes.push(data0);
                }
            }
        }
        for (let channelName in this._channels) {
            if (transformedChannelName === this._gettransformedChannelNameForDiscovery({channelName, nodeId: this._nodeId})) {
                // report self
                const selfData = this._createNodeData();
                nodes.push(selfData);
            }
        }
        if (Object.keys(nodes).length > 0) {
            const responseMessage = {
                type: 'findChannelPeersResponse',
                transformedChannelName,
                nodes
            };
            this._remoteNodeManager.sendMessageDirectlyToPeer(fromNodeId, responseMessage);
        }
    }
    _handleFindChannelPeersResponse({ fromNodeId, message }) {
        // one of two mechanisms to discover nodes and get updated info
        validateNodeId(fromNodeId);
        validateObject(message, '/FindChannelPeersResponseMessage');

        // this response should only come from a bootstrap peer.
        for (let bpm of this._bootstrapPeerManagers) {
            if (bpm.peerId() === fromNodeId) {
                bpm.handleFindChannelPeersResponse(message);
            }
        }
    }
    _gettransformedChannelNameForDiscovery({channelName, nodeId}) {
        validateChannelName(channelName);
        validateNodeId(nodeId);

        return sha1sum(`discovery:${channelName}:${nodeId}`);
    }
    _gettransformedChannelNameForAnnounce({channelName, nodeId}) {
        validateChannelName(channelName);
        validateNodeId(nodeId);

        return sha1sum(`announce:${channelName}:${nodeId}`);
    }
    _nodeIsInOneOfOurChannels(nodeId) {
        validateNodeId(nodeId);

        for (let channelName in this._channels) {
            const ids = this.getNodeIdsForChannel(channelName);
            if (ids.includes(nodeId)) {
                return true;
            }
        }
        return false;
    }
    async _startPrintInfo() {
        let lastInfoText = '';
        while (true) {
            if (this._halt) return;
            const infoText = await this._getInfoText();
            if (infoText !== lastInfoText) {
                console.info('____________________________________');
                console.info(infoText);
                console.info('____________________________________');
                console.info('');
                lastInfoText = infoText;
            }
            await sleepMsec(500);
        }
    }
    async _startDiscoverLocalNodes() {
        // to find nodes on the local network
        const multicastSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });
        const multicastAddress = '233.0.0.0'; // not sure how to choose this
        const multicastPort = 21009;
        multicastSocket.bind(multicastPort);
        multicastSocket.on("listening", function() {
            multicastSocket.addMembership(multicastAddress);
        });
        multicastSocket.on("message", (message, rinfo) => {
            let msg  = null;
            try {
                msg = JSON.parse(message)
            }
            catch(err) {
            }
            if ((msg) && (msg.kacheryProtocolVersion == protocolVersion()) && (msg.body) && (msg.signature) && (msg.body.fromNodeId) && (msg.body.fromNodeId !== this._nodeId)) {
                if (verifySignature(msg.body, msg.signature, hexToPublicKey(msg.body.fromNodeId), {checkTimestamp: true})) {
                    if ((msg.body.message) && (msg.body.message.type === 'announcing')) {
                        try {
                            validateObject(msg.body.message, '/AnnouncingMessage');
                        }
                        catch(err) {
                            // console.warn(`Problem in message from local node: ${err.message}`);
                            return;
                        }
                        this._handleAnnouncingMessage({ fromNodeId: msg.body.fromNodeId, message: msg.body.message });
                    }
                }
            }
        });
        await sleepMsec(1000);
        while (true) {
            if (this._halt) return;
            const body = {
                fromNodeId: this._nodeId,
                message: {
                    type: 'announcing',
                    nodeData: this._createNodeData(),
                    localAddress: this._websocketServer.listenAddress(),
                    localPort: this._websocketServer.listenPort()
                },
                timestamp: (new Date()) - 0
            };
            validateObject(body.message, '/AnnouncingMessage');
            const m = {
                kacheryProtocolVersion: protocolVersion(),
                body,
                signature: getSignature(body, this._keyPair)
            };
            const mjson = JSON.stringify(m);
            multicastSocket.send(
                mjson,
                0,
                mjson.length,
                multicastPort,
                multicastAddress
            );
            await sleepMsec(10000);
        }
    }
    async _start() {
        // this._startDiscoverNodes();
        this._startPrintInfo();
        this._startDiscoverLocalNodes();
    }
}

class NoRouteToNodeError extends Error {
    constructor(data) {
        super(`No route to node`);
        this.name = this.constructor.name
        Error.captureStackTrace(this, this.constructor);
        this.data = data;
    }
}

class UnexpectedInternalError extends Error {
    constructor(message) {
        super(`Unexpected: ${message}`);
        this.name = this.constructor.name
        Error.captureStackTrace(this, this.constructor);
    }
}

class SignatureError extends Error {
    constructor(data) {
        super(`Error verifying signature`);
        this.name = this.constructor.name
        Error.captureStackTrace(this, this.constructor);
        this.data = data;
    }
}

class RouteError extends Error {
    constructor(message) {
        super(`Route error: ${message}`);
        this.name = this.constructor.name
        Error.captureStackTrace(this, this.constructor);
    }
}

class InvalidNodeInfoError extends Error {
    constructor({nodeInfo, error}) {
        console.warn(nodeInfo);
        super(`Invalid node info: ${error.message}`);
        this.name = this.constructor.name
        Error.captureStackTrace(this, this.constructor);
        this.nodeInfo = nodeInfo;
    }
}

const fileKeysMatch = (k1, k2) => {
    validateObject(k1, '/FileKey');
    validateObject(k2, '/FileKey');

    if (k1.sha1) {
        return k1.sha1 === k2.sha1;
    }
    else if (k1.transformedSha1) {
        return k1.transformedSha1 === k2.transformedSha1;
    }
    else if (k1.type === 'liveFeed') {
        if (k1.feedId) {
            return ((k1.type === k2.type) && (k1.feedId === k2.feedId));
        }
        else if (k1.transformedFeedId) {
            return ((k1.type === k2.type) && (k1.transformedFeedId === k2.transformedFeedId));
        }
        else {
            return false;
        }
    }
    else {
        return false;
    }
}

function cloneObject(obj) {
    if (!obj) return obj;
    return JSON.parse(JSON.stringify(obj));
}

const _transformFileKey = ({fileKey, nodeId}) => {
    validateObject(fileKey, '/FileKey');
    let transformedFileKey;
    if (fileKey.sha1) {
        transformedFileKey = {
            sha1Head: fileKey.sha1.slice(0, 10),
            transformNodeId: nodeId,
            transformedSha1: sha1sum(nodeId + fileKey.sha1)
        };
        if (fileKey.chunkOf) {
            validateObject(fileKey.chunkOf, '/ChunkOf');
            validateObject(fileKey.chunkOf.fileKey, '/FileKey');
            transformedFileKey.chunkOf = {
                ...fileKey.chunkOf,
                fileKey: _transformFileKey({fileKey: fileKey.chunkOf.fileKey, nodeId})
            }
        }
    }
    else if (fileKey.feedId) {
        transformedFileKey = {
            type: fileKey.type,
            feedIdHead: fileKey.feedId.slice(0, 10),
            transformNodeId: nodeId,
            transformedFeedId: sha1sum(nodeId + fileKey.feedId)
        };
    }
    else {
        transformedFileKey = fileKey;
    }
    validateObject(transformedFileKey, '/FileKey');
    return transformedFileKey;
}

export default Node;