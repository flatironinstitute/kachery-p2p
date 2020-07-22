import { randomAlphaString } from '../../common/util.js';
import { verifySignature, hexToPublicKey } from '../../common/crypto_util.js';

class HyperswarmPeerConnection {
    constructor({keyPair, nodeId, swarmName, peerId, verbose}) {
        this._keyPair = keyPair;
        this._nodeId = nodeId;

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

        this._onSignedMessageCallbacks = {};

        this._timestampLastIncomingMessage = new Date();
        this._timestampLastOutgoingMessage = new Date();

        this._disconnected = false;
    }
    // safe
    setIncomingSocket(jsonSocket) {
        this._incomingJsonSocket = jsonSocket;
        this._incomingJsonSocket.on('message', msg => {
            // safe
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
        try {
            this._incomingJsonSocket.sendMessage({type: 'ready'});
        }
        catch(err) {
            if (this._verbose >= 1) {
                console.warn(err);
                console.warn('Could not send message to incoming socket. Disconnecting.');
            }
            this.disconnect();
        }
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
        try {
            this._outgoingJsonSocket.sendMessage({type: 'ready'});
        }
        catch(err) {
            if (this._verbose >= 1) {
                console.warn(err);
                console.warn('Could not send message to outgoing socket. Disconnecting.');
            }
            this.disconnect();
        }
    }
    peerIsLocal() {
        return this._connectionInfo.local;
    }
    // safe
    async _handleMessage(msg) {
        this._timestampLastIncomingMessage = new Date();
        if (msg.type === 'keepAlive') {
            return;
        }
        else if (msg.type === 'signedMessage') {
            setTimeout(() => {
                for (let id in this._onSignedMessageCallbacks) {
                    const x = this._onSignedMessageCallbacks[id];
                    x.callback(msg.signedMessage, x.details);
                }
            }, 0);
        }
    }
    onSignedMessage = (cb) => {
        const callbackId = randomAlphaString(10);
        const details = {
            removeCallback: () => {delete this._onSignedMessageCallbacks[callbackId];}
        };
        this._onSignedMessageCallbacks[callbackId] = {
            callback: cb,
            details
        }
        return details;
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
        try {
            socket.sendMessage(msg);
        }
        catch(err) {
            if (this._verbose >= 1) {
                console.warn(err);
                console.warn('Error sending message')
            }
        }
    }
    // safe
    sendMessage = (msg) => {
        this._timestampLastOutgoingMessage = new Date();
        this.asyncSendMessage(msg);
    }
    sendSignedMessage = (signedMessage) => {
        if (!verifySignature(signedMessage.body, signedMessage.signature, hexToPublicKey(signedMessage.body.fromNodeId))) {
            console.warn('HYPERSWARM: Unexpected problem verifying signature before sending signed message. Not sending.');
            return;
        }
        this.sendMessage({
            type: 'signedMessage',
            signedMessage
        });
    }
    setConnectionInfo = (info) => {
        this._connectionInfo = info;
    }
    connectionInfo = () => {
        return this._connectionInfo;
    }
    disconnect = () => {
        if (this._disconnected) return;
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

export default HyperswarmPeerConnection;