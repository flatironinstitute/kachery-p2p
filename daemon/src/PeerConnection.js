import { randomString } from './util.js';
import fs from 'fs';
import { info } from 'console';

class PeerConnection {
    constructor({swarmName, peerId, verbose}) {
        this._swarmName = swarmName;
        this._peerId = peerId;
        this._verbose = verbose;

        this._incomingJsonSocket = null;
        this._outgoingJsonSocket = null;

        this._incomingSocketReady = false;
        this._outgoingSocketReady = false;

        this._incomingSocketReadyCallbacks = [];
        this._outgoingSocketReadyCallbacks = [];

        this._connectionInfo = {};

        this._waitForMessageTestFunctions = {};

        this._onMessageCallbacks = {};

        this._timestampLastIncomingMessage = new Date();
        this._timestampLastOutgoingMessage = new Date();

        this._disconnected = false;
    }
    setIncomingSocket(jsonSocket) {
        this._incomingJsonSocket = jsonSocket;
        this._incomingJsonSocket.on('message', msg => {
            if (msg.type === 'ready') {
                this._incomingSocketReady = true;
                for (let cb of this._incomingSocketReadyCallbacks) {
                    cb();
                }
            }
            else {
                this._handleMessage(msg);
            }
        })
        this._incomingJsonSocket.sendMessage({type: 'ready'});
    }
    async _handleMessage(msg) {
        this._timestampLastIncomingMessage = new Date();
        if (this._verbose >= 2) {
            console.info(`handleMessage: ${this._swarmName} ${this._peerId} ${msg.type}`);
        }
        if (msg.type === 'keepAlive') {
            return;
        }
        for (let id in this._onMessageCallbacks) {
            const x = this._onMessageCallbacks[id];
            x.callback(msg, x.details);
        }
    }
    onMessage = (cb) => {
        const callbackId = randomString(10);
        const details = {
            removeCallback: () => {delete this._onMessageCallbacks[callbackId];}
        };
        this._onMessageCallbacks[callbackId] = {
            callback: cb,
            details
        }
        return details;
    }
    makeRequestToNode = (nodeIdPath, requestBody, opts, onResponse, onFinished) => {
        const requestId = opts.requestId;
        const message = {
            type: 'requestToNode',
            nodeIdPath,
            requestId,
            requestBody
        };
        this.sendMessage(message);
        this.onMessage((msg, details) => {
            if (msg.type === 'requestToNodeResponse') {
                if (msg.requestId === requestId) {
                    onResponse(msg.responseBody);
                }
            }
            else if (msg.type === 'requestToNodeFinished') {
                if (msg.requestId === requestId) {
                    details.removeCallback();
                    onFinished();
                }
            }
        })
    }
    makeRequestToAllNodes = (requestBody, opts, onNodeResponse, onFinished) => {
        const requestId = opts.requestId;
        const message = {
            type: 'requestToAllNodes',
            requestId,
            requestBody
        };
        this.sendMessage(message);
        this.onMessage((msg, details) => {
            if (msg.type === 'requestToAllNodesResponse') {
                if (msg.requestId === requestId) {
                    onNodeResponse(msg.nodeIdPath, msg.responseBody);
                }
            }
            else if (msg.type === 'requestToAllNodesFinished') {
                if (msg.requestId === requestId) {
                    details.removeCallback();
                    onFinished();
                }
            }
        })
    }
    setOutgoingSocket(jsonSocket) {
        this._outgoingJsonSocket = jsonSocket;
        this._outgoingJsonSocket.on('message', msg => {
            if (msg.type === 'ready') {
                this._outgoingSocketReady = true;
                for (let cb of this._outgoingSocketReadyCallbacks) {
                    cb();
                }
            }
            else {
                this._handleMessage(msg);
            }
        })
        this._outgoingJsonSocket.sendMessage({type: 'ready'});
    }
    asyncSendMessage = async (msg) => {
        if (this._disconnected) return;
        const _waitForSocketReady = async () => {
            if (this._incomingSocketReady) return this._incomingJsonSocket;
            if (this._outgoingSocketReady) return this._outgoingJsonSocket;
            return new Promise((resolve, reject) => {
                let resolved = false;
                this._incomingSocketReadyCallbacks.push(() => {
                    if (resolved) return;
                    resolved = true;
                    resolve(this._incomingJsonSocket);
                    return;
                });
                this._outgoingSocketReadyCallbacks.push(() => {
                    if (resolved) return;
                    resolved = true;
                    resolve(this._outgoingJsonSocket);
                    return;
                });
            });
        }
        const socket = await _waitForSocketReady();
        if (this._disconnected) return;
        socket.sendMessage(msg);
    }
    sendMessage(msg) {
        this._timestampLastOutgoingMessage = new Date();
        if (this._verbose >= 2) {
            console.info(`sendMessage: ${this._swarmName} ${this._peerId} ${msg.type}`);
        }
        this.asyncSendMessage(msg);
    }
    setConnectionInfo(info) {
        this._connectionInfo = info;
    }
    connectionInfo() {
        return this._connectionInfo;
    }
    disconnect() {
        this._disconnected = true;
        if (this._incomingJsonSocket) {
            this._incomingJsonSocket._socket.destroy();
        }
        if (this._outgoingJsonSocket) {
            this._outgoingJsonSocket._socket.destroy();
        }
    }
    elapsedTimeSecSinceLastIncomingMessage() {
        return ((new Date()) - this._timestampLastIncomingMessage) / 1000;
    }
    elapsedTimeSecSinceLastOutgoingMessage() {
        return ((new Date()) - this._timestampLastOutgoingMessage) / 1000;
    }
}

export default PeerConnection;