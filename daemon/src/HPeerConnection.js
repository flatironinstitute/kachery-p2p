import { randomString } from './util.js';
import { getSignature, verifySignature, publicKeyToHex, hexToPublicKey } from './crypto_util.js';

class HPeerConnection {
    constructor({keyPair, nodeId, swarmName, peerId, verbose}) {
        this._keyPair = keyPair;
        this._nodeId = nodeId;
        if (this._nodeId !== publicKeyToHex(this._keyPair.publicKey.toString('hex'))) {
            throw Error('public key not consistent with node ID (HPeerConnection).');
        }
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
    // safe
    setIncomingSocket(jsonSocket) {
        this._incomingJsonSocket = jsonSocket;
        this._incomingJsonSocket.on('message', msg => {
            // safe
            if (!this._verifyMessageFromPeer(msg)) {
                console.warn(msg);
                console.warn('Error verifying message. Disconnecting peer.');
                this.disconnect();
                return;
            }
            if (msg.body.type === 'ready') {
                this._incomingSocketReady = true;
                setTimeout(() => {
                    for (let cb of this._incomingSocketReadyCallbacks) {
                        cb();
                    }
                }, 0);
            }
            else {
                this._handleMessage(msg.body);
            }
        })
        try {
            this._incomingJsonSocket.sendMessage(this._signMessage({type: 'ready'}));
        }
        catch(err) {
            console.warn(err);
            console.warn('Could not send message. Disconnecting.');
            this.disconnect();
        }
    }
    // safe
    async _handleMessage(msg) {
        this._timestampLastIncomingMessage = new Date();
        if (msg.type === 'keepAlive') {
            //
        }
        else {
            //
        }
        if (msg.type === 'keepAlive') {
            return;
        }
        setTimeout(() => {
            for (let id in this._onMessageCallbacks) {
                const x = this._onMessageCallbacks[id];
                x.callback(msg, x.details);
            }
        }, 0);
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
    setOutgoingSocket(jsonSocket) {
        this._outgoingJsonSocket = jsonSocket;
        this._outgoingJsonSocket.on('message', msg => {
            if (!this._verifyMessageFromPeer(msg)) {
                console.warn(msg);
                console.warn('Error verifying message. Disconnecting peer.');
                this.disconnect();
                return;
            }
            if (msg.body.type === 'ready') {
                this._outgoingSocketReady = true;
                for (let cb of this._outgoingSocketReadyCallbacks) {
                    cb();
                }
            }
            else {
                this._handleMessage(msg.body);
            }
        })
        this._outgoingJsonSocket.sendMessage(this._signMessage({type: 'ready'}));
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
            socket.sendMessage(this._signMessage(msg));
        }
        catch(err) {
            console.warn(err);
            console.warn('Error sending message')
        }
    }
    // safe
    sendMessage = (msg) => {
        this._timestampLastOutgoingMessage = new Date();
        if (msg.type === 'keepAlive') {
            //
        }
        else {
            //
        }
        this.asyncSendMessage(msg);
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
    // safe
    _signMessage = (msgBody) => {
        const signature = getSignature(msgBody, this._keyPair);
        if (!signature) {
            throw Error('Error signing message.');
        }
        return {
            body: msgBody,
            signature: signature
        }
    }
    // safe
    _verifyMessageFromPeer = msg => {
        if (!msg.body) return false;
        if (!msg.signature) return false;
        let peerPublicKey;
        try {
            peerPublicKey = hexToPublicKey(this._peerId, 'hex');
        }
        catch(err) {
            console.warn(err);
            console.warn('Problem converting peer ID to public key.')
            return false;
        }
        // safe
        return verifySignature(msg.body, msg.signature, peerPublicKey);
    }
}

export default HPeerConnection;