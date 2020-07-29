import fs from 'fs';
import { getSignature, verifySignature, hexToPublicKey } from '../common/crypto_util.js';
import { sleepMsec, randomAlphaString } from '../common/util.js';
import { getLocalFileInfo } from '../kachery.js';
import Peer from './Peer.js';
import SmartyNode from './SmartyNode.js';
import { log } from '../common/log.js';
import assert from 'assert';
import Stream from 'stream';
import WebsocketServer from './WebsocketServer.js';
import crypto from 'crypto';
import BootstrapPeerManager from './BootstrapPeerManager.js';

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
        this._address = address;
        this._port = port;
        this._udpAddress = udpAddress;
        this._udpPort = udpPort;
        this._feedManager = feedManager;
        this._label = label;
        this._handledBroadcastMessages = {};
        this._messageListeners = {}; // listeners for incoming
        this._halt = false;

        this._bootstrapPeerManagers = [];

        this._onProvidingCallbacks = [];
        this._onRequestCallbacks = [];

        this._channels = {}; // by channel name ---- {[channelName]: {nodes: {[nodeId]: {timestamp: ..., nodeInfo: ...}}}}
        this._peers = {}; // by peerId
        this._findChannelNodesLookup = {}; // {[channelName]: {nodes: {[nodeId]: {signature, body: {timestamp, nodeInfo}}}}

        this._websocketServer = this._initializeServer({ type: 'websocket', listenPort: this._port });
        if (this._udpPort) {
            this._udpServer = this._initializeServer({ type: 'udp', listenPort: this._udpPort });
        }
        else {
            this._udpServer = null;
        }

        this._smartyNode = new SmartyNode(this);

        this.onRequest(({channelName, fromNodeId, requestBody, onResponse, onError, onFinished}) => {
            this._handleRequestFromNode({channelName, fromNodeId, requestBody, onError, onFinished});
        });

        this._start();
    }
    nodeInfo() {
        return {
            nodeId: this._nodeId,
            address: this._address,
            port: this._port,
            udpAddress: this._udpAddress,
            udpPort: this._udpPort,
            label: this._label
        }
    }
    halt() {
        for (let channelName in this._channels) {
            this.leaveChannel(channelName);
        }
        this._halt = true;
    }
    getPeerIds({channelName}) {
        const ret = [];
        const CH = this._channels[channelName] || {nodes: {}};
        for (let nodeId in CH.nodes) {
            if (nodeId in this._peers)
                ret.push(nodeId);
        }
        return ret;
    }
    async addBootstrapPeer({address, port}) {
        this._bootstrapPeerManagers.push(
            new BootstrapPeerManager(this, {address, port})
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
        this._channels[channelName] = { nodes: {} };
    }
    leaveChannel(channelName) {
        this._validateChannelName(channelName);
        log().info('Leaving channel', { channelName });
        if (channelName in this._channels) {
            delete this._channels[channelName];
            this._cleanupPeers();
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
    async sendMessageToNode({ channelName, toNodeId, route, message }) {
        this._validateChannelName(channelName, { mustBeJoined: true });
        this._validateNodeId(toNodeId, { mustBeInChannel: channelName });
        if (route) {
            this._validateRoute(route, { mustEndWithNode: toNodeId, mustContainNode: this._nodeId });
        }
        this._validateMessage(message);

        if (!route) {
            //  check if we can send it directly to peer
            if (toNodeId in this._peers) {
                if (this._peers[toNodeId].hasConnection()) {
                    this._peers[toNodeId].sendMessage(message);
                    return;
                }
            }
            route = await this._smartyNode.which_route_should_i_use_to_send_a_message_to_this_peer({ channelName, toNodeId, calculateIfNeeded: true })
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
    // .onRequest(({fromNodeId, requestBody, onResponse, onError, onFinished})) => {...});
    onRequest(cb) {
        this._onRequestCallbacks.push(cb);
    }
    makeRequestToNode = ({ channelName, toNodeId, requestBody, timeout, requestId }) => {
        timeout = timeout || null;
        requestId = requestId || randomAlphaString(10);
        this._validateChannelName(channelName, { mustBeJoined: true });
        this._validateNodeId(toNodeId, { mustBeInChannel: channelName });
        this._validateRequestBody(requestBody);
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
        this.sendMessageToNode({ channelName, toNodeId, route: null, message });
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

        if (timeout) {
            setTimeout(() => {
                if (!isFinished) {
                    handleError('Timeout while waiting for response.');
                }
            }, timeout);
        }

        listener.onMessage(async ({ fromNodeId, message }) => {
            if (message.type === 'requestToNodeReceived') {
                handleReceived();
            }
            else if (message.type === 'requestToNodeResponse') {
                const responseIndex = message.responseIndex;
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
                while (lastResponseIndex + 1 < message.numResponses) {
                    await sleepMsec(10);
                }
                handleFinished();
            }
        });
        return {
            requestId,
            onResponse: cb => onResponseCallbacks.push(cb),
            onError: cb => onErrorCallbacks.push(cb),
            onFinished: cb => onFinishedCallbacks.push(cb),
            // todo: think about doing more here - send out a cancel message to node
            cancel: () => { handleFinished(); listener.cancel(); }
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
        this._validateNodeId(nodeId, {mustBeInChannel: channelName});
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
        
                const req = this.makeRequestToNode({channelName, toNodeId: nodeId, requestBody, timeout: 10000});
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

    _handleRequestFromNode({channelName, fromNodeId, requestBody, onResponse, onError, onFinished}) {
        this._validateChannelName(channelName, {mustBeInChannel: true});
        this._validateNodeId(fromNodeId);
        this._validateSimpleObject(requestBody);
        this._validateFunction(onResponse);
        this._validateFunction(onError);
        this._validateFunction(onFinished);
        if (requestBody.type === 'downloadFile') {
            this._handleDownloadFileRequest({
                channelName, fromNodeId, requestBody, onResponse, onError, onFinished
            })
        }
        else if (requestBody.type === 'getLiveFeedSignedMessages') {
            this._handleGetLiveFeedSignedMessages({
                channelName, fromNodeId, requestBody, onResponse, onError, onFinished
            })
        }
        else if (requestBody.type === 'submitMessageToLiveFeed') {
            this._handleSubmitMessagesToLiveFeed({
                channelName, fromNodeId, requestBody, onResponse, onError, onFinished
            })
        }
    }

    _getInfoText() {
        const makeNodeLine = (nodeId, nodeInfo) => {
            const ni = nodeInfo || {};
            const p = this._peers[nodeId];
            const hasIn = p ? p.hasIncomingWebsocketConnection() : false;
            const hasOut = p ? p.hasOutgoingWebsocketConnection() : false;
            const hasUdpIn = p ? p.hasIncomingUdpConnection() : false;
            const hasUdpOut = p ? p.hasOutgoingUdpConnection() : false;
            const bootstrap = p ? p.isBootstrapPeer() : false;

            if (bootstrap) {
                ni.address = ni.address || p.bootstrapPeerInfo().address;
                ni.port = ni.port || p.bootstrapPeerInfo().port;
            }

            // const hasRoute = await this._swarmConnection.hasRouteToPeer(peerId);
            const hasRoute = false;
            const items = [];
            if (bootstrap) items.push('bootstrap');
            if (hasIn) items.push('in');
            if (hasOut) items.push('out');
            if (hasUdpIn) items.push('udp-in');
            if (hasUdpOut) items.push('udp-out');
            if (hasRoute) items.push('route');
            return `Node ${nodeId.slice(0, 6)}... ${ni.label || ''}: ${ni.address || ""}:${ni.port || ""} ${items.join(' ')}`;
        }

        const lines = [];
        const nodesIncluded = {};
        for (let channelName in this._channels) {
            lines.push(`CHANNEL: ${channelName}`);
            lines.push(`self ${this._nodeId.slice(0, 6)}`);
            const CH = this._channels[channelName];
            for (let nodeId in CH.nodes) {
                nodesIncluded[nodeId] = true;
                const nodeInfo = CH.nodes[nodeId].data.body.nodeInfo;
                lines.push(makeNodeLine(nodeId, nodeInfo));
            }
            lines.push('');
        }
        lines.push('OTHER');
        for (let nodeId in this._peers) {
            if (!nodesIncluded[nodeId]) {
                lines.push(makeNodeLine(nodeId, null));
            }
        }
        return lines.join('\n');
    }

    async _handleDownloadFileRequest({channelName, fromNodeId, requestBody, onResponse, onError, onFinished}) {
        this._validateChannelName(channelName, {mustBeInChannel: true});
        this._validateNodeId(fromNodeId);
        this._validateSimpleObject(requestBody);
        this._validateFunction(onResponse);
        this._validateFunction(onError);
        this._validateFunction(onFinished);
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
    async _handleGetLiveFeedSignedMessages({channelName, fromNodeId, requestBody, onResponse, onError, onFinished}) {
        this._validateChannelName(channelName, {mustBeInChannel: true});
        this._validateNodeId(fromNodeId);
        this._validateSimpleObject(requestBody);
        this._validateFunction(onResponse);
        this._validateFunction(onError);
        this._validateFunction(onFinished);

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
            onError(`Error getting signed messages: ${err.message}`);
            return;
        }
        onResponse({
            signedMessages
        });
        onFinished();
    }
    async _handleSubmitMessagesToLiveFeed({channelName, fromNodeId, requestBody, onResponse, onError, onFinished}) {
        this._validateChannelName(channelName, {mustBeInChannel: true});
        this._validateNodeId(fromNodeId);
        this._validateSimpleObject(requestBody);
        this._validateFunction(onResponse);
        this._validateFunction(onError);
        this._validateFunction(onFinished);
        
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
            onError(`Error submitting messages: ${err.message}`);
            return;
        }
        // mo response needed
        onFinished();
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
            X = new WebsocketServer({nodeId: this._nodeId, keyPair: this._keyPair, useUdp: true}); // todo
        }
        else {
            throw new UnexpectedInternalError(`Unexpected type: ${type}`)
        }

        X.onIncomingConnection(connection => {
            try {
                this._validateConnectionObject(connection);
                const nodeId = connection.remoteNodeId();
                this._validateNodeId(nodeId);
                if (!(nodeId in this._peers)) {
                    this._createPeer(nodeId);                    
                }
                const P = this._peers[nodeId];
                if (P) {
                    P.setIncomingConnection({ type, connection });
                }
                else {
                    throw new Error('Unable to create peer for connection. ');
                }
            }
            catch(err) {
                console.warn(`Failed to handle incoming connection. Disconnecting. (${err.message})`);
                connection.disconnect();
            }
        });

        if (listenPort) {
            X.listen(listenPort);
        }

        return X;
    }

    _handleMessage({ fromNodeId, message }) {
        this._validateNodeId(fromNodeId);
        this._validateMessage(message);
        if (message.type === 'broadcast') {
            this._handleBroadcastMessage({ fromNodeId, message });
        }
        else if (message.type === 'messageToNode') {
            this._handleMessageToNode({ fromNodeId, message });
        }
        else if (message.type === 'requestToNode') {
            this._handleRequestToNode({ fromNodeId, message });
        }
        else if (message.type === 'seeking') {
            this._handleSeekingMessage({ fromNodeId, message });
        }
        else if (message.type === 'providing') {
            this._handleProvidingMessage({ fromNodeId, message });
        }
        else if (message.type === 'findChannelNodes') {
            this._handleFindChannelNodes({ fromNodeId, message });
        }
        else if (message.type === 'findChannelNodesResponse') {
            this._handleFindChannelNodesResponse({ fromNodeId, message });
        }
        else if (message.type === 'announcing') {
            this._handleAnnouncingMessage({ fromNodeId, message });
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

    _createPeer(nodeId) {
        console.info(`Adding peer: ${nodeId.slice(0, 6)}`);
        this._validateNodeId(nodeId);
        if (nodeId in this._peers) return;
        const P = new Peer({ peerId: nodeId });
        P.onMessage(message => {
            this._handleMessage({ fromNodeId: nodeId, message });
        });
        this._peers[nodeId] = P;
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
        if (!(channelName in this._channels)) return;

        const signature = message.signature;
        if (!verifySignature(body, signature, hexToPublicKey(body.fromNodeId))) {
            throw new SignatureError({fromNodeId: body.fromNodeId});
        }
        if (fromNodeId !== this._nodeId) {
            // don't handle it ourselves if we are the ones sending it.
            this._handleMessage({ fromNodeId: body.fromNodeId, message: body.message })
        }
        for (let nodeId in this._channels[channelName].nodes) {
            if ((nodeId !== fromNodeId) && (nodeId in this._peers)) {
                const P = this._peers[nodeId];
                if (P.hasConnection()) {
                    P.sendMessage(message);
                }
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
        if (!(channelName in this._channels)) return;

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
            if (!(nextNodeId in this._peers)) {
                throw new RouteError('No peer that is the next item in the route');
            }
            const P = this._peers[nextNodeId];
            if (P.hasConnection()) {
                P.sendMessage({ channelName, message });
            }
            else {
                throw new RouteError('Peer that is next in the route has no connection.');
            }
        }
        else {
            throw new RouteError(`No route in message to node.`);
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
        this._onRequestCallbacks.forEach(cb => {
            cb({
                channelName,
                fromNodeId,
                requestId,
                requestBody,
                onResponse: responseBody => {
                    this._validateSimpleObject(responseBody);
                    this.sendMessageToNode({ channelName, toNodeId: fromNodeId, message: { type: 'requestToNodeResponse', requestId, responseBody, responseIndex: numResponses } });
                    numResponses++;
                },
                onError: errorString => {
                    this._validateString(errorString);
                    this.sendMessageToNode({ channelName, toNodeId: fromNodeId, message: { type: 'requestToNodeError', requestId, errorString } });
                },
                onFinished: () => {
                    this.sendMessageToNode({ channelName, toNodeId: fromNodeId, message: { type: 'requestToNodeFinished', numResponses, requestId } });
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
        const channelName = message.channelName;
        this._handleReceiveNodeInfo({channelName, data: data0});
    }
    _createFindChannelNodesDataForSelf() {
        const body = {
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
        
        if (!this._peers[fromNodeId]) {
            throw new Error('findChannelNodes must come from peer. Peer not found.');
        }
        if (!this._peers[fromNodeId].hasConnection()) {
            throw new Error('findChannelNodes must come from peer with aconnection. Peer connection not found.');
        }
        if (!(channelName in this._findChannelNodesLookup)) {
            this._findChannelNodesLookup[channelName] = { nodes: {} };
        }
        const x = this._findChannelNodesLookup[channelName];
        x.nodes[fromNodeId] = {
            internalTimestamp: new Date(),
            data
        };
        const nodes = {};
        for (let nodeId in x.nodes) {
            if (nodeId !== fromNodeId) {
                const elapsed = (new Date()) - x.nodes[nodeId].internalTimestamp;
                if (elapsed < 60000) {
                    nodes[nodeId] = x.nodes[nodeId].data;
                }
                else {
                    delete x.nodes[nodeId];
                }
            }
        }
        if (channelName in this._channels) {
            // report self
            nodes[this._nodeId] = this._createFindChannelNodesDataForSelf();
        }
        if (Object.keys(nodes).length > 0) {
            this._peers[fromNodeId].sendMessage({
                type: 'findChannelNodesResponse',
                channelName,
                nodes
            });
        }
    }
    _handleReceiveNodeInfo({ channelName, data }) {
        // called by the two mechanisms for discovering nodes and getting updated nodeInfo data
        // This system allows us to trust that the node info is coming from the node itself
        this._validateChannelName(channelName, {mustBeJoined: true});
        let CH = this._channels[channelName];
        this._validateSimpleObject(data, {fields: {
            signature: {optional: false, type: 'string'},
            body: {optional: false}
        }});
        assert(data.body.timestamp, 'Missing timestamp');
        this._validateNodeInfo(data.body.nodeInfo);
        const nodeId = data.body.nodeInfo.nodeId;
        this._validateNodeId(nodeId);
        if (!verifySignature(data.body, data.signature, hexToPublicKey(data.body.nodeInfo.nodeId))) {
            throw new SignatureError({nodeId: data.body.nodeInfo.nodeId, fromNodeId});
        }
        let okayToReplace = false;
        if (nodeId in CH.nodes) {
            const difference = data.body.timestamp - CH.nodes[nodeId].data.body.timestamp;
            if (difference > 0) {
                okayToReplace = true;
            }
        }
        else {
            okayToReplace = true;
        }
        if (okayToReplace) {
            CH.nodes[nodeId] = {
                internalTimestamp: new Date(), // for deciding when to delete it internal to this component -- don't use remote timestamp because it might be a different time zone - only use remote timestamp for comparing and determining most recent
                data: data
            };
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
            this._handleReceiveNodeInfo({channelName, data: data0});
        }
    }
    _nodeIsInOneOfOurChannels(nodeId) {
        this._validateNodeId(nodeId);
        for (let channelName in this._channels) {
            if (nodeId in this._channels[channelName].nodes) {
                return true;
            }
        }
        return false;
    }
    _cleanupPeers() {
        for (let peerId in this._peers) {
            const P = this._peers[peerId];
            if (!P.isBootstrapPeer()) {
                if (!this._nodeIsInOneOfOurChannels(peerId)) {
                    if (P.hasOutgoingConnection()) {
                        console.info(`Removing outgoing connections to peer because it is not in any of our channels: ${peerId.slice(0, 6)}`);
                        P.disconnectOutgoingConnections();
                    }
                }
            }
        }
        for (let peerId in this._peers) {
            const P = this._peers[peerId];
            if (!P.hasConnection()) {
                console.info(`Removing peer: ${peerId.slice(0, 6)}`);
                P.disconnect();
                delete this._peers[peerId];
            }
        }
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
    _validateConnectionObject(connection) {
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
        if (opts.mustBeInChannel) {
            const channelName = opts.mustBeInChannel;
            if (!(channelName in this._channels)) {
                throw new Error(`Not joined to channel (validating node id): ${channelName}`);
            }
            if (!(nodeId in this._channels[channelName].nodes)) {
                throw new Error(`Node ${nodeId} is not in channel ${channelName}`);
            }
        }
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
                    }
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
                if (!(k in opts.fields)) {
                    throw new Error(`Invalid field in object: ${k}`);
                }
                validateField({field: opts.fields[k], value: val, key: k});
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

    async _startAnnouncingSelf() {
        sleepMsec(1000);
        while (true) {
            if (this._halt) return;
            for (let channelName in this._channels) {
                const message = {
                    type: 'announcing',
                    data: this._createFindChannelNodesDataForSelf(),
                    channelName
                };
                this.broadcastMessage({ channelName, message });
            }
            await sleepMsec(10000);
        }
    }

    async _startOutgoingConnections() {
        // start aggressively and then slow down
        let delayMsec = 1000;
        while (true) {
            await sleepMsec(delayMsec);
            if (this._halt) return;
            for (let channelName in this._channels) {
                const CH = this._channels[channelName];
                for (let nodeId in CH.nodes) {
                    assert(CH.nodes[nodeId].internalTimestamp, 'Unexpected, missing internalTimestamp');
                    const elapsed = (new Date()) - CH.nodes[nodeId].internalTimestamp;
                    if (elapsed < 120000) {
                        const nodeInfo = CH.nodes[nodeId].data.body.nodeInfo;
                        this._validateNodeInfo(nodeInfo);

                        if ((nodeInfo.address) && (nodeInfo.port)) {
                            if ((!this._peers[nodeId]) || (!this._peers[nodeId].hasOutgoingWebsocketConnection())) {
                                let C = null;
                                try {
                                    // todo: there is a problem where we may try the connection multiple times if the peer belongs to multiple channels that we are in
                                    C = await this._websocketServer.createOutgoingWebsocketConnection({
                                        address: nodeInfo.address,
                                        port: nodeInfo.port,
                                        remoteNodeId: nodeId
                                    });
                                }
                                catch (err) {
                                    // console.warn(`Problem creating outgoing connection to node. ${err.message}`);
                                }
                                if (C) {
                                    if (!this._peers[nodeId]) {
                                        this._createPeer(nodeId);
                                    }
                                    const P = this._peers[nodeId];
                                    if (P) {
                                        P.setOutgoingConnection({ type: 'websocket', connection: C });
                                    }
                                    else {
                                        console.warn(`Unable to create peer for outgoing connection. Disconnecting.`);
                                        C.disconnect();
                                    }
                                }
                            }
                        }

                        if ((nodeInfo.udpAddress) && (nodeInfo.udpPort) && (this._udpServer)) {
                            if ((!this._peers[nodeId]) || (!this._peers[nodeId].hasOutgoingUdpConnection())) {
                                let C = null;
                                try {
                                    // todo: there is a problem where we may try the connection multiple times if the peer belongs to multiple channels that we are in
                                    C = await this._udpServer.createOutgoingWebsocketConnection({
                                        address: nodeInfo.address,
                                        port: nodeInfo.port,
                                        remoteNodeId: nodeId
                                    });
                                }
                                catch (err) {
                                    // console.warn(`Problem creating outgoing connection to node. ${err.message}`);
                                }
                                if (C) {
                                    if (!this._peers[nodeId]) {
                                        this._createPeer(nodeId);
                                    }
                                    const P = this._peers[nodeId];
                                    if (P) {
                                        P.setOutgoingConnection({ type: 'udp', connection: C });
                                    }
                                    else {
                                        console.warn(`Unable to create peer for outgoing connection. Disconnecting.`);
                                        C.disconnect();
                                    }
                                }
                            }
                        }
                    }
                    else {
                        delete CH.nodes[nodeId];
                    }
                }
            }
            delayMsec *= 2;
            if (delayMsec >= 10000) {
                delayMsec = 10000;
            }
        }
    }
    async _startCleanupPeers() {
        await sleepMsec(1000);
        while (true) {
            if (this._halt) return;
            this._cleanupPeers();
            await sleepMsec(2000);
        }
    }
    async _startDiscoverNodes() {
        // start aggressively and then slow down
        let delayMsec = 1000;
        while (true) {
            await sleepMsec(delayMsec);
            if (this._halt) return;
            const data0 = this._createFindChannelNodesDataForSelf();
            for (let channelName in this._channels) {
                const message = {
                    type: 'findChannelNodes',
                    channelName,
                    data: data0
                }
                for (let peerId in this._peers) {
                    const P = this._peers[peerId];
                    if (P.hasConnection()) {
                        P.sendMessage(message);
                    }
                }
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
        this._startAnnouncingSelf();
        this._startOutgoingConnections();
        this._startCleanupPeers();
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

export default Node;