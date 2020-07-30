import fs from 'fs';
import { getSignature, verifySignature, hexToPublicKey } from '../common/crypto_util.js';
import { sleepMsec, randomAlphaString } from '../common/util.js';
import { getLocalFileInfo } from '../kachery.js';
import SmartyNode from './SmartyNode.js';
import { log } from '../common/log.js';
import assert from 'assert';
import Stream from 'stream';
import WebsocketServer from './WebsocketServer.js';
import crypto from 'crypto';
import BootstrapPeerManager from './BootstrapPeerManager.js';
import RemoteNodeManager from './RemoteNodeManager.js';
import util from 'util';

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

        this._websocketServer = this._initializeServer({ type: 'websocket', listenPort: this._nodeInfo.port });
        this._udpServer = this._initializeServer({ type: 'udp', listenPort: this._nodeInfo.udpPort });
        this._udpServer.onUdpPublicEndpointChanged(() => this._handleUdpPublicEndpointChanged());

        this._activeIncomingRequests = {}; // by request id

        this._smartyNode = new SmartyNode(this);

        this.onRequest(({channelName, fromNodeId, requestBody, sendResponse, reportError, reportFinished, onCanceled, onResponseReceived}) => {
            this._handleRequestFromNode({channelName, fromNodeId, requestBody, sendResponse, reportError, reportFinished, onCanceled, onResponseReceived});
        });

        this._start();
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
        return this._remoteNodeManager.peerIdsForChannel(channelName);
    }
    getNodeIdsForChannel(channelName) {
        return this._remoteNodeManager.remoteNodeIdsForChannel(channelName);
    }
    async addBootstrapPeer({address, port}) {
        this._bootstrapPeerManagers.push(
            new BootstrapPeerManager({remoteNodeManager: this._remoteNodeManager, websocketServer: this._websocketServer, address, port})
        );
    }
    onProviding(cb) {
        this._onProvidingCallbacks.push(cb);
    }
    broadcastMessage({ channelName, message }) {
        const broadcastMessageId = randomAlphaString(10);
        const body = {
            channelName,
            broadcastMessageId,
            fromNodeId: this._nodeId,
            message
        };
        const message2 = {
            type: 'broadcast',
            body,
            signature: getSignature(body, this._keyPair)
        };
        this._handleBroadcastMessage({ fromNodeId: this._nodeId, message: message2 });
    }
    joinChannel(channelName) {
        this._validateChannelName(channelName);
        log().info('Joining channel', { channelName });
        if (channelName in this._channels) {
            return;
        }
        this._channels[channelName] = true;
    }
    leaveChannel(channelName) {
        this._validateChannelName(channelName);
        log().info('Leaving channel', { channelName });
        if (channelName in this._channels) {
            delete this._channels[channelName];
        }
    }
    hasJoinedChannel(channelName) {
        this._validateChannelName(channelName);
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
        this._validateChannelName(channelName, { mustBeJoined: true });
        this._validateNodeId(toNodeId);
        this._validateBool(direct);
        if (route) {
            this._validateRoute(route, { mustEndWithNode: toNodeId, mustContainNode: this._nodeId });
            if (direct) {
                throw Error('Cannot provide route with direct=true');
            }
        }
        this._validateMessage(message);

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
            message
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
    createMessageListener(testFunction, opts) {
        opts = opts || {};
        this._validateFunction(testFunction);
        this._validateSimpleObject(opts, { fields: { name: { optional: true } } });

        const x = {
            name: opts.name || randomAlphaString(10),
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
        this._onRequestCallbacks.push(cb);
    }
    makeRequestToNode = ({ channelName, toNodeId, requestBody, direct=false, timeout, requestId }) => {
        timeout = timeout || null;
        requestId = requestId || randomAlphaString(10);
        this._validateChannelName(channelName, { mustBeJoined: true });
        this._validateNodeId(toNodeId);
        this._validateRequestBody(requestBody);
        this._validateBool(direct);
        if (timeout !== null) {
            this._validateInteger(timeout);
        }
        this._validateString(requestId, { minLength: 10, maxLength: 10 });

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
    findFileOrLiveFeed = ({channelName, fileKey, timeoutMsec=4000}) => {
        this._validateChannelName(channelName, {mustBeJoined: true});
        this._validateSimpleObject(fileKey);
        this._validateInteger(timeoutMsec);
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
        this.broadcastMessage({
            channelName,
            message: {
                type: 'seeking',
                channelName,
                fileKey
            }
        });
        this.onProviding((x) => { // todo: fix this memory leak
            if (isFinished) return;
            this._validateSimpleObject(x);
            this._validateChannelName(x.channelName);
            this._validateNodeId(x.nodeId);
            this._validateSimpleObject(x.fileKey);
            if (x.fileInfo) {
                this._validateSimpleObject(x.fileInfo);
            }
            if ((x.channelName === channelName) && (fileKeysMatch(x.fileKey, fileKey))) {
                const result = {
                    channel: x.channelName,
                    nodeId: x.nodeId,
                    fileKey: x.fileKey,
                    fileInfo: x.fileInfo
                }
                onFoundCallbacks.forEach(cb => {cb(result);});
            }
        });
        setTimeout(() => {
            handleCancel();
        }, timeoutMsec);
        return ret;
    }
    async downloadFile({channelName, nodeId, fileKey, startByte, endByte}) {
        this._validateChannelName(channelName, {mustBeJoined: true});
        this._validateNodeId(nodeId);
        this._validateSimpleObject(fileKey);
        this._validateInteger(startByte);
        this._validateInteger(endByte);

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
        
                const req = this.makeRequestToNode({channelName, toNodeId: nodeId, requestBody, timeout: 20000});
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
                        console.warn(err);
                        console.warn(`Problem in downloadChunks`);
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
    async getLiveFeedSignedMessages({channelName, nodeId, feedId, subfeedName, position, waitMsec}) {
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
        this._validateChannelName(channelName, {mustBeInChannel: true});
        this._validateNodeId(fromNodeId);
        this._validateSimpleObject(requestBody);
        this._validateFunction(sendResponse);
        this._validateFunction(reportError);
        this._validateFunction(reportFinished);
        this._validateFunction(onCanceled);
        this._validateFunction(onResponseReceived);
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
        else if (requestBody.type === 'submitMessageToLiveFeed') {
            this._handleSubmitMessagesToLiveFeed({
                channelName, fromNodeId, requestBody, sendResponse, reportError, reportFinished, onCanceled, onResponseReceived
            })
        }
    }

    _handleUdpPublicEndpointChanged() {
        const remote = this._udpServer.udpPublicEndpoint();
        if (remote) {
            console.info('Setting udp public endpoint', remote);
            if ((remote.address !== this._nodeInfo.udpAddress) || (remote.port !== this._nodeInfo.port)) {
                this._nodeInfo.udpAddress = remote.address || null;
                this._nodeInfo.udpPort = remote.port || null;
                this._remoteNodeManager.setLocalNodeInfo(this._nodeInfo);
            }
        }
    }

    _announceSelfToPeersAndJoinedChannelsNow() {
        const message = {
            type: 'announcing',
            data: this._createNodeData()
        };
        for (let channelName in this._channels) {
            this.broadcastMessage({channelName, message});
        }
        this._remoteNodeManager.sendMessageToAllPeersNotInJoinedChannels(message);
    }

    async _hasRouteToNode({channelName, toNodeId}) {
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
            return `Node${hasUdpAddress ? '*' : ''} ${nodeId.slice(0, 6)}... ${ni.label || ''}: ${ni.address || ""}:${ni.port || ""} ${items.join(' ')}`;
        }

        const lines = [];
        const nodesIncluded = {};
        const selfHasUdpAddress = ((this._nodeInfo.udpAddress) && (this._nodeInfo.udpPort));
        for (let channelName in this._channels) {
            lines.push(`CHANNEL: ${channelName}`);
            lines.push(`self${selfHasUdpAddress ? '*' : ''} ${this._nodeId.slice(0, 6)}`);
            const nodeIdsInChannel = this.getNodeIdsForChannel(channelName); // todo
            for (let nodeId of nodeIdsInChannel) {
                nodesIncluded[nodeId] = true;
                const nodeInfo = this._remoteNodeManager.remoteNodeInfo(nodeId);
                lines.push(await makeNodeLine({channelName, nodeId, nodeInfo}));
            }
            lines.push('');
        }
        lines.push('OTHER');
        lines.push(`self${selfHasUdpAddress ? '*' : ''} ${this._nodeId.slice(0, 6)}`);
        const peerIds = this._remoteNodeManager.peerIds();
        for (let nodeId of peerIds) {
            if (!nodesIncluded[nodeId]) {
                const nodeInfo = this._remoteNodeManager.remoteNodeInfo(nodeId);
                lines.push(await makeNodeLine({channelName: null, nodeId, nodeInfo}));
            }
        }
        return lines.join('\n');
    }

    async _handleDownloadFileRequest({channelName, fromNodeId, requestBody, sendResponse, reportError, reportFinished, onCanceled, onResponseReceived}) {
        this._validateChannelName(channelName, {mustBeInChannel: true});
        this._validateNodeId(fromNodeId);
        this._validateSimpleObject(requestBody);
        this._validateFunction(sendResponse);
        this._validateFunction(reportError);
        this._validateFunction(reportFinished);
        const fileInfo = await getLocalFileInfo({fileKey: requestBody.fileKey});
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
        if (fileInfo) {
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

            const AA = 50;
            const BB = 5000;

            const asyncOpen = util.promisify(fs.open);
            const asyncRead = util.promisify(fs.read);

            const file = await asyncOpen(fileSystemPath);
            const messageChunkSize = 30000;
            let i = requestBody.startByte;
            const buffer = new Buffer(messageChunkSize);
            while ( i < requestBody.endByte) {
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
                        await sleepMsec(20);
                    }
                }
                const i1 = i;
                const i2 = Math.min(i1 + messageChunkSize, requestBody.endByte);
                const x = await asyncRead(file, buffer, 0, i2 - i1, i1);
                if (x.bytesRead !== i2 - i1) {
                    throw Error('Problem reading file. Unexpected number of bytes read.');
                }
                sendResponse({
                    data_b64: buffer.slice(0, i2 - i1).toString('base64')
                });
                numResponsesSent ++;

                i = i2;
            }
            while ((numResponsesSent - numResponsesReceived > 0) && (!canceled)) {
                await sleepMsec(20);
            }
            reportFinished();

            // const readStream = fs.createReadStream(fileSystemPath, {start: requestBody.startByte, end: requestBody.endByte - 1 /* notice the -1 here */});

            // function splitIntoChunks(data, chunkSize) {
            //     const ret = [];
            //     let i = 0;
            //     while (i < data.length) {
            //         ret.push(
            //             data.slice(i, Math.min(i + chunkSize, data.length))
            //         );
            //         i += chunkSize;
            //     }
            //     return ret;
            // }

            // readStream.on('data', data => {
            //     const messageChunkSize = 30000; // need to worry about the max size of udp messages
            //     let dataChunks = splitIntoChunks(data, messageChunkSize);
            //     dataChunks.forEach(dataChunk => {
            //         sendResponse({
            //             data_b64: dataChunk.toString('base64')
            //         });
            //     });
            // });
            // readStream.on('end', () => {
            //     reportFinished();
            // });
        }
        else {
            reportError('Unable to find file.');
        }
    }
    async _handleGetLiveFeedSignedMessages({channelName, fromNodeId, requestBody, sendResponse, reportError, reportFinished}) {
        this._validateChannelName(channelName, {mustBeInChannel: true});
        this._validateNodeId(fromNodeId);
        this._validateSimpleObject(requestBody);
        this._validateFunction(sendResponse);
        this._validateFunction(reportError);
        this._validateFunction(reportFinished);

        this._validateSimpleObject(requestBody, {fields: {
            type: {optional: false},
            feedId: {optional: false, type: 'string'},
            subfeedName: {optional: false, type: 'string'},
            position: {optional: false},
            waitMsec: {optional: false}
        }});
        const {feedId, subfeedName, position, waitMsec} = requestBody;
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
    async _handleSubmitMessagesToLiveFeed({channelName, fromNodeId, requestBody, sendResponse, reportError, reportFinished}) {
        this._validateChannelName(channelName, {mustBeInChannel: true});
        this._validateNodeId(fromNodeId);
        this._validateSimpleObject(requestBody);
        this._validateFunction(sendResponse);
        this._validateFunction(reportError);
        this._validateFunction(reportFinished);
        
        this._validateSimpleObject(requestBody, {fields: {
            feedId: {optional: false, type: 'string'},
            subfeedName: {optional: false, type: 'string'},
            messages: {optional: false}
        }});

        const {feedId, subfeedName, messages} = requestBody;
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

    _initializeServer({ type, listenPort }) {
        this._validateString(type, {choices: ['websocket', 'udp']});
        if (listenPort) {
            this._validateInteger(listenPort);
        }

        let X;
        if (type === 'websocket') {
            X = new WebsocketServer({ nodeId: this._nodeId, keyPair: this._keyPair });
        }
        else if (type === 'udp') {
            X = new WebsocketServer({ nodeId: this._nodeId, keyPair: this._keyPair, useUdp: true });
        }
        else {
            throw new UnexpectedInternalError(`Unexpected type: ${type}`)
        }

        X.onIncomingConnection(connection => {
            try {
                this._validateConnection(connection);
                const nodeId = connection.remoteNodeId();
                this._validateNodeId(nodeId);
                this._remoteNodeManager.setIncomingConnection({nodeId, type, connection});
            }
            catch(err) {
                console.warn(`Failed to handle incoming connection. Disconnecting. (${err.message})`);
                connection.disconnect();
            }
        });

        if ((listenPort) || (type === 'udp')) {
            X.listen(listenPort);
        }

        return X;
    }

    _handleMessage({ fromNodeId, message }) {
        this._validateNodeId(fromNodeId);
        this._validateMessage(message);
        if (message.type === 'announcing') {
            this._handleAnnouncingMessage({ fromNodeId, message });
        }
        else if (message.type === 'broadcast') {
            this._handleBroadcastMessage({ fromNodeId, message });
        }
        else if (message.type === 'cancelRequestToNode') {
            this._handleCancelRequestToNode({ fromNodeId, message });
        }
        else if (message.type === 'findChannelNodes') {
            this._handleFindChannelNodes({ fromNodeId, message });
        }
        else if (message.type === 'findChannelNodesResponse') {
            this._handleFindChannelNodesResponse({ fromNodeId, message });
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
        this._validateNodeId(fromNodeId);
        this._validateMessage(message);

        const body = message.body;
        this._validateSimpleObject(body);
        
        const broadcastMessageId = body.broadcastMessageId
        this._validateString(broadcastMessageId, {minLength: 10, maxLength: 10});

        if (this._handledBroadcastMessages[broadcastMessageId]) {
            return;
        }
        // todo: fix this memory leak
        this._handledBroadcastMessages[broadcastMessageId] = true;

        const channelName = body.channelName;
        this._validateChannelName(channelName, {mustBeJoined: true});

        this._validateNodeId(body.fromNodeId);
        this._validateMessage(body.message);

        this._validateChannelName(channelName, {mustBeJoined: true});

        const signature = message.signature;
        if (!verifySignature(body, signature, hexToPublicKey(body.fromNodeId))) {
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
        this._validateNodeId(fromNodeId);
        this._validateMessage(message);

        const body = message.body;
        const channelName = body.channelName;

        this._validateNodeId(body.fromNodeId);
        this._validateNodeId(body.toNodeId);
        this._validateMessage(body.message);

        this._validateChannelName(channelName, {mustBeJoined: true});

        const signature = message.signature;
        if (!verifySignature(body, signature, hexToPublicKey(body.fromNodeId))) {
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
        this._validateNodeId(fromNodeId);
        this._validateMessage(message);
        const requestId = message.requestId;
        this._validateString(requestId, {minLength: 10, maxLength: 10});

        if (requestId in this._activeIncomingRequests) {
            this._activeIncomingRequests[requestId].onCanceledCallbacks.forEach(cb => cb());
        }
    }
    _handleRequestToNodeResponseReceived({ fromNodeId, message }) {
        this._validateNodeId(fromNodeId);
        this._validateMessage(message);
        const requestId = message.requestId;
        this._validateString(requestId, {minLength: 10, maxLength: 10});
        const responseIndex = message.responseIndex;
        this._validateInteger(responseIndex);

        if (requestId in this._activeIncomingRequests) {
            this._activeIncomingRequests[requestId].onResponseReceivedCallbacks.forEach(cb => cb(responseIndex));
        }
    }
    _handleRequestToNode({ fromNodeId, message }) {
        this._validateNodeId(fromNodeId);
        this._validateMessage(message);

        const requestId = message.requestId;
        const requestBody = message.requestBody;
        const channelName = message.channelName;

        this._validateString(requestId, {minLength: 10, maxLength: 10});
        this._validateSimpleObject(requestBody);
        this._validateChannelName(channelName, {mustBeJoined: true});

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
                    this._validateSimpleObject(responseBody);
                    this.sendMessageToNode({ channelName, toNodeId: fromNodeId, message: { type: 'requestToNodeResponse', requestId, responseBody, responseIndex: numResponses } });
                    numResponses++;
                    return numResponses - 1;
                },
                reportError: errorString => {
                    this._validateString(errorString);
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
        this._validateNodeId(fromNodeId);
        this._validateMessage(message);
        const fileKey = message.fileKey;
        const channelName = message.channelName;
        this._validateSimpleObject(fileKey);
        this._validateChannelName(channelName, {mustBeJoined: true});
        if (fileKey.sha1) {
            const fileInfo = await getLocalFileInfo({ fileKey });
            if (fileInfo) {
                if ('path' in fileInfo)
                    delete fileInfo['path'];
                const message2 = {
                    type: 'providing',
                    channelName,
                    fileKey,
                    fileInfo
                };
                this.sendMessageToNode({ channelName, toNodeId: fromNodeId, message: message2 });
            }
        }
        else if (fileKey.feedId) {
            this._validateString(fileKey.feedId);
            if (await this._feedManager.hasWriteableFeed({ feedId: fileKey.feedId })) {
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
        this._validateNodeId(fromNodeId);
        this._validateMessage(message);
        const fileKey = message.fileKey;
        const fileInfo = message.fileInfo || null;
        const channelName = message.channelName;

        this._validateSimpleObject(fileKey);
        if (fileInfo) {
            this._validateSimpleObject(fileInfo);
        }
        this._validateChannelName(channelName, {mustBeJoined: true});

        this._onProvidingCallbacks.forEach(cb => {
            cb({ channelName, nodeId: fromNodeId, fileKey, fileInfo });
        });
    }
    async _handleAnnouncingMessage({ fromNodeId, message }) {
        // one of two mechanisms to discover nodes and get updated info
        this._validateNodeId(fromNodeId);
        this._validateMessage(message);
        this._validateSimpleObject(message.data);
        this._validateString(message.data.signature);
        this._validateSimpleObject(message.data.body);
        assert(message.data.body.timestamp, 'Missing timestamp');
        this._validateSimpleObject(message.data.body.nodeInfo);
        this._validateNodeInfo(message.data.body.nodeInfo);
        assert(message.data.body.nodeInfo.nodeId === fromNodeId, 'Mismatch in node id');
        const data0 = message.data;
        this._remoteNodeManager.setRemoteNodeData(fromNodeId, data0);
    }
    _createNodeData() {
        const channels0 = {};
        for (let channelName in this._channels) {
            channels0[channelName] = true;
        }
        const body = {
            channels: channels0,
            nodeInfo: this.nodeInfo(),
            timestamp: (new Date()) - 0
        };
        return {
            body,
            signature: getSignature(body, this._keyPair)
        };
    }
    _handleFindChannelNodes({ fromNodeId, message }) {
        // This system allows us to trust that the node info is coming from the node itself
        this._validateNodeId(fromNodeId);
        this._validateMessage(message);

        const channelName = message.channelName;
        this._validateChannelName(channelName);

        const data = message.data;
        this._validateSimpleObject(data);
        this._validateString(data.signature);
        this._validateSimpleObject(data.body);
        this._validateSimpleObject(data.body.nodeInfo);
        this._validateNodeInfo(data.body.nodeInfo);
        assert(fromNodeId === data.body.nodeInfo.nodeId, 'Mismatch with node id');
        assert(data.body.timestamp, 'Missing timestamp');

        if (!verifySignature(data.body, data.signature, hexToPublicKey(fromNodeId))) {
            throw new SignatureError({fromNodeId});
        }
        
        if (!this._remoteNodeManager.isPeer(fromNodeId)) {
            throw new Error('findChannelNodes must come from peer.');
        }
        this._remoteNodeManager.setRemoteNodeData(fromNodeId, data);
        const nodeIds = this._remoteNodeManager.remoteNodeIdsForChannel(channelName);
        const nodes = {};
        for (let nodeId of nodeIds) {
            if (nodeId !== fromNodeId) {
                const data0 = this._remoteNodeManager.remoteNodeData(nodeId);
                if (data0) {
                    nodes[nodeId] = data0;
                }
            }
        }
        const selfData = this._createNodeData();
        if (channelName in selfData.body.channels) {
            // report self
            nodes[this._nodeId] = selfData;
        }
        if (Object.keys(nodes).length > 0) {
            const responseMessage = {
                type: 'findChannelNodesResponse',
                channelName,
                nodes
            };
            this._remoteNodeManager.sendMessageDirectlyToPeer(fromNodeId, responseMessage);
        }
    }
    _handleFindChannelNodesResponse({ fromNodeId, message }) {
        // one of two mechanisms to discover nodes and get updated info
        this._validateNodeId(fromNodeId);
        this._validateMessage(message);

        const channelName = message.channelName;
        const nodes = message.nodes;

        this._validateChannelName(channelName, {mustBeJoined: true});
        this._validateSimpleObject(nodes);

        for (let nodeId in nodes) {
            this._validateNodeId(nodeId);
            const data0 = nodes[nodeId];
            this._remoteNodeManager.setRemoteNodeData(nodeId, data0);
        }
    }
    _nodeIsInOneOfOurChannels(nodeId) {
        this._validateNodeId(nodeId);
        const nodeData = this._remoteNodeManager.remoteNodeData(nodeId);
        if (!nodeData) return false;
        const nodeChannels = nodeData.body.channels;
        for (let channelName in this._channels) {
            if (channelName in nodeChannels) {
                return true;
            }
        }
        return false;
    }
    _validateChannelName(channelName, opts) {
        opts = opts || {};
        assert(typeof(channelName) === 'string', `Channel name must be a string`);
        assert(channelName.length >= 3, `Length of channel name must be at least 3`);
        assert(channelName.length <= 80, `Length of channel name must be at most 80`);
        if (opts.mustBeJoined) {
            if (!(channelName in this._channels)) {
                throw new Error(`Not joined to channel: ${channelName}`);
            }
        }
    }
    _validateConnection(connection) {
        // todo
    }
    _validateFunction(f) {
        assert(typeof(f) === 'function', 'Not a function.');
    }
    _validateInteger(x) {
        assert(typeof(x) === 'number', 'Not an integer.');
        assert(Math.floor(x) === x, 'Not an integer.')
    }
    _validateMessage(msg) {
        try {
            this._validateSimpleObject(msg);
        }
        catch(err) {
            throw new Error(`Message is not an object.`);
        }
    }
    _validateNodeId(nodeId, opts) {
        opts = opts || {};
        assert(typeof(nodeId) === 'string', `Node ID must be a string`);
        assert(nodeId.length == 64, `Length of node ID must be 64`);
    }
    _validateNodeInfo(nodeInfo) {
        try {
            this._validateSimpleObject(
                nodeInfo,
                {
                    fields: {
                        nodeId: {optional: false, type: 'string', minLength: 64, maxLength: 64},
                        address: {optional: true, type: 'string', nullOkay: true, minLength: 0, maxLength: 80},
                        port: {optional: true, type: 'integer', nullOkay: true},
                        udpAddress: {optional: true,  type: 'string', nullOkay: true, minLength: 0, maxLength: 80},
                        udpPort: {optional: true, type: 'integer', nullOkay: true},
                        label: {optional: false, type: 'string', minLength: 0, maxLength: 160}
                    },
                    additionalFieldsOkay: true
                }
            )
        }
        catch(error) {
            throw new InvalidNodeInfoError({nodeInfo, error});
        }
    }
    _validateRequestBody(x) {
        try {
            this._validateSimpleObject(x);
        }
        catch(err) {
            throw new Error('Invalid request body');
        }
    }
    _validateRoute(route, opts) {
        opts = opts || {};
        if (!Array.isArray(route)) {
            throw new Error(`Invalid route`);
        }
        if (opts.mustEndWithNode) {
            if (route[route.length - 1] !== opts.mustEndWithNode) {
                throw new Error(`Route does not end with node: ${opts.mustEndWithNode}`);
            }
        }
        if (opts.mustContainNode) {
            if (route.indexOf(opts.mustContainNode) < 0) {
                throw new Error(`Route does not contain node: ${opts.mustContainNode}`);
            }
        }
    }
    _validateSimpleObject(x, opts) {

        const validateField = ({field, value, key}) => {
            if (value === null) {
                if (field.nullOkay) {
                    return; // we are okay
                }
            }
            const f = field;
            const val = value;
            const k = key;
            if (f.type === 'string') {
                assert(typeof(val) === 'string', `Field not a string: ${k} ${value}`);
                if (f.minLength) {
                    assert(val.length >= f.minLength, `Length of string must be at least ${f.minLength}`);
                }
                if (f.maxLength) {
                    assert(val.length <= f.maxLength, `Length of string must be at least ${f.maxLength}`);
                }
            }
            else if (f.type === 'integer') {
                assert(typeof(val) === 'number', `Field not an integer: ${k}`);
            }
        }

        assert(typeof(x) === 'object', `Not an object`);
        opts = opts || {};
        if (opts.fields) {
            for (let k in x) {
                let val = x[k];
                if (k in opts.fields) {
                    validateField({field: opts.fields[k], value: val, key: k});
                }
                else {
                    if (!opts.additionalFieldsOkay) {
                        throw new Error(`Invalid field in object: ${k}`);
                    }
                }
            }
            for (let k in opts.fields) {
                if (!opts.fields[k].optional) {
                    if (!(k in x)) {
                        throw new Error(`Missing field in object: ${k}`);
                    }
                }
            }
        }
        // not doing more validation right now because we don't want to take a long time
    }
    _validateString(x, opts) {
        opts = opts || {};
        assert(typeof(x) === 'string', `Not a string`);
        if (opts.minLength) {
            assert(x.length >= opts.minLength, `Length of string must be at least ${x.length}`);
        }
        if (opts.maxLength) {
            assert(x.length <= opts.maxLength, `Length of string must be at most ${x.length}`);
        }
    }
    _validateBool(x, opts) {
        opts = opts || {};
        assert(typeof(x) === 'boolean', `Not a boolean`);
    }

    
    async _startDiscoverNodes() {
        // start aggressively and then slow down
        let delayMsec = 1000;
        while (true) {
            await sleepMsec(delayMsec);
            if (this._halt) return;
            const data0 = this._createNodeData();
            for (let channelName in this._channels) {
                const message = {
                    type: 'findChannelNodes',
                    channelName,
                    data: data0
                }
                this._remoteNodeManager.sendMessageToAllPeers(message);
            }
            delayMsec *= 2;
            if (delayMsec >= 20000) {
                delayMsec = 20000;
            }
        }
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
    async _start() {
        this._startDiscoverNodes();
        this._startPrintInfo();
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

function cloneObject(obj) {
    if (!obj) return obj;
    return JSON.parse(JSON.stringify(obj));
}

export default Node;