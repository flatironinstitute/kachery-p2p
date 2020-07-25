import dgram from 'dgram';
import { JSONStringifyDeterministic, verifySignature, hexToPublicKey, getSignature } from './common/crypto_util.js'
import { log } from './common/log.js';


class UdpClientConnection {
    constructor({nodeId, keyPair, remoteNodeId, remoteAddress, remotePort, swarmName, protocolVersion}) {
        this._nodeId = nodeId;
        this._keyPair = keyPair;
        this._swarmName = swarmName;
        this._protocolVersion = protocolVersion;
        this._remoteNodeId = remoteNodeId;
        this._remoteAddress = remoteAddress;
        this._remotePort = remotePort;
        this._onMessageCallbacks = [];
        this._onDisconnectCallbacks = [];
        this._onConnectCallbacks = [];
        this._connectionId = null;
        this._socket = dgram.createSocket('udp4');
        this._socket.onMessage((messageTxt, remote) => {
            let msg;
            try {
                msg = JSON.parse(messageTxt);
            }
            catch {
                log().warning('UdpClientConnection: Unable to parse udp message', {remote});
                return;
            }
            if ((!msg.body) || (!msg.signature)) {
                log().warning('UdpClientConnection: Improper udp message', {remote});
                return;
            }
            const { body, signature } = message;
            const fromNodeId = body.fromNodeId;
            const message = body.message;
            if (!fromNodeId) {
                log().warning('UdpClientConnection: No body.fromNodeId in udp message', {remote});
                return;
            }
            if (fromNodeId !== this._remoteNodeId) {
                log().warning('UdpClientConnection: fromNodeId does not match toNodeId', {remote, fromNodeId, remoteNodeId: this._remoteNodeId});
                return;
            }
            if (!message) {
                log().warning('UdpClientConnection: No body.message in udp message', {remote});
                return;
            }
            if (!verifySignature(body, signature, hexToPublicKey(fromNodeId))) {
                log().warning('UdpClientConnection: Unable to verify signature in udp message', {remote});
                return;
            }
            this._handleMessageFromRemote(remote, message);
        });
        this.sendMessage({
            type: 'openConnection',
            initialInfo: {
                swarmName: this._swarmName,
                nodeId: this._nodeId,
                protocolVersion: this._protocolVersion
            }
        });
    }
    onMessage(cb) {
        this._onMessageCallbacks.push(cb);
    }
    onDisconnect(cb) {
        this._onDisconnectCallbacks.push(cb);
    }
    onConnect(cb) {
        this._onConnectCallbacks.push(cb);
    }
    sendMessage(message) {
        const body = {
            fromNodeId: this._nodeId,
            message,
        };
        if (this._connectionId) {
            body.connectionId = this._connectionId;
        }
        else {
            if (message.type !== 'openConnection') {
                this._queuedMessages.push(message);
                return;
            }
        }
        const signedMessage = {
            body,
            signature: getSignature(responseBody, this._keyPair)
        }
        const signedMessageTxt = JSONStringifyDeterministic(signedMessage);
        socket.send(signedMessageTxt, this._remotePort, this._remoteAddress, (err, numBytesSent) => {
            if (err) {
                log.warning('Failed to send udp message to remote', {remoteAddress: this._remoteAddress, remotePort: this._remotePort, messageType: message.type, error: err.message});
                return;
            }
            if (numBytesSent !== signedMessageTxt.length) {
                log.warning('Problem sending udp message to remote: numBytesSent does not equal expected', {remoteAddress: this._remoteAddress, remotePort: this._remotePort, numBytesSent, messageLenth: signedMessageTxt.length});
                return;
            }
        });
    }
    disconnect() {
        this.sendMessage({
            type: 'closeConnection'
        });
        this._onDisconnectCallbacks.forEach(cb => cb());
    }
    _handleMessageFromRemote(remote, message) {
        // todo: do we want to update the remote connection info here based on remote, if they differ??
        if (message.type === 'connectionOpened') {
            if (!message.connectionId) {
                log().warning('UdpClientConnection: No connectionId in connectionOpened message', {});
                return;
            }
            this._connectionId = message.connectionId;
            const qm = this._queuedMessages;
            this._queuedMessages = [];
            for (let m of qm) {
                this.sendMessage(m);
            }
            this._onConnectCallbacks.forEach(cb => cb());
        }
        else {
            this._onMessageCallbacks.forEach(cb => cb(message));
        }
    }
}

export default UdpClientConnection;