import { JSONStringifyDeterministic, verifySignature, hexToPublicKey, getSignature } from '../common/crypto_util.js'
import dgram from 'dgram';
import { randomAlphaString, sleepMsec } from '../common/util.js';

class InternalUdpServer {
    constructor(port) {
        this._onConnectionCallbacks = [];
        this._incomingConnections = {}; // by connection id
        this._outgoingConnections = {}; // by connection id
        this._pendingOutgoingConnections = {}; // by connection id
        this._publicEndpoint = null;
        this._publicEndpointChangedCallbacks = [];
        this._handledUdpMessages = {};
        this._outgoingMessagesWaitingForAcknowledgement = {};
        
        const socket = dgram.createSocket('udp4');
        if (port)
            socket.bind(port, '');
        else
            socket.bind();
        socket.on('listening', () => {
            // console.info('Udp socket', socket.address());
        });
        socket.on('message', (messageTxt, remote) => {
            let message;
            try {
                message = JSON.parse(messageTxt);
            }
            catch {
                console.warn('Unable to parse udp message', {remote});
                return;
            }
            if (message.receivedUdpMessageId) {
                this._handleReceivedUdpMessage(message.receivedUdpMessageId);
                return;
            }
            if (!message.udpMessageId) {
                return;
            }
            const udpMessageId = message.udpMessageId;
            // Note: it's important to acknowledge receipt before checking if we already handled it
            // that's because maybe the confirmation was lost the last time
            const acknowledgeReceivedMsg = {
                receivedUdpMessageId: udpMessageId
            };
            _udpSocketSend(this._socket, acknowledgeReceivedMsg, remote.port, remote.address);

            if (udpMessageId in this._handledUdpMessages) {
                return;
            }
            this._handledUdpMessages[udpMessageId] = {timestamp: new Date()};

            this._handleIncomingMessage(message.message, remote);
        });
        this._socket = socket;

        this._start();
    }
    on(name, cb) {
        if (name === 'connection')
            this._onConnectionCallbacks.push(cb);
    }
    publicEndpoint() {
        return this._publicEndpoint;
    }
    onPublicEndpointChanged(cb) {
        this._publicEndpointChangedCallbacks.push(cb);
    }
    _createOutgoingUdpConnection({address, port}) {
        const connectionId = randomAlphaString(10);
        const C = new UdpConnection({udpServer: this, connectionId, remoteAddress: address, remotePort: port});
        C.on('close', () => {
            if (connectionId in this._pendingOutgoingConnections) {
                delete this._pendingOutgoingConnections[connectionId];
            }
            if (connectionId in this._outgoingConnections) {
                delete this._outgoingConnections[connectionId];
            }
        })
        this._pendingOutgoingConnections[connectionId] = C;
        const openMessage = {
            type: 'openConnection',
            connectionId
        };
        this._prepareAndSendMessage({message: openMessage, port, address});
        return C;
    }
    _handleIncomingMessage(message, remote) {
        if ((message.type === 'openConnection') && (isValidConnectionId(message.connectionId))) {
            if (message.connectionId in this._incomingConnections) {
                console.warn(`openConnection: connection with id already exists: ${message.connectionId}`);
                return;
            }
            const C = new UdpConnection({
                udpServer: this,
                connectionId: message.connectionId,
                remoteAddress: remote.address,
                remotePort: remote.port
            });
            C.on('close', () => {
                if (this._incomingConnections[message.connectionId]) {
                    delete this._incomingConnections[message.connectionId];
                }
            });
            this._incomingConnections[message.connectionId] = C;
            const acceptMessage = {
                type: 'acceptConnection',
                connectionId: message.connectionId,
                initiatorPublicEndpoint: remote // the public endpoint of the initiator to the connection
            };
            this._prepareAndSendMessage({message: acceptMessage, port: remote.port, address: remote.address});
            C._setOpen();
            this._onConnectionCallbacks.forEach(cb => {
                cb(C);
            });
        }
        else if ((message.type === 'acceptConnection') && (isValidConnectionId(message.connectionId))) {
            if (message.connectionId in this._pendingOutgoingConnections) {
                const C = this._pendingOutgoingConnections[message.connectionId];
                const ipe = message.initiatorPublicEndpoint;
                // make sure it really is a public endpoint
                if ((ipe) && (ipe.address) && (!ipe.address.startsWith('127.0.0')) && (!ipe.address.startsWith('0.')) && (C.remoteAddress() !== 'localhost')) {
                    if ((!this._publicEndpoint) || (JSONStringifyDeterministic(this._publicEndpoint) !== message.initiatorPublicEndpoint)) {
                        this._publicEndpoint = message.initiatorPublicEndpoint;
                        this._publicEndpointChangedCallbacks.forEach(cb => cb());
                    }
                }
                this._outgoingConnections[message.connectionId] = C
                delete this._pendingOutgoingConnections[message.connectionId];
                C._setOpen();
            }
        }
        else if (message.connectionId) {
            if (message.connectionId in this._incomingConnections) {
                this._incomingConnections[message.connectionId]._handleIncomingMessage(message.message);
            }
            else if (message.connectionId in this._outgoingConnections) {
                this._outgoingConnections[message.connectionId]._handleIncomingMessage(message.message);
            }
        }
        else {
            // don't do anything
        }
    }
    _handleReceivedUdpMessage(udpMessageId) {
        if (udpMessageId in this._outgoingMessagesWaitingForAcknowledgement) {
            delete this._outgoingMessagesWaitingForAcknowledgement[udpMessageId];
        }
    }
    _prepareAndSendMessage({message, port, address, numTries=1, udpMessageId=undefined}) {
        udpMessageId = udpMessageId ||  randomAlphaString(10);
        const message2 = {
            udpMessageId,
            message
        };
        this._outgoingMessagesWaitingForAcknowledgement[udpMessageId] = {
            port,
            address,
            message,
            timestamp: new Date(),
            numTries
        };
        _udpSocketSend(this._socket, message2, port, address);
    }

    async _start() {
        while (true) {
            await sleepMsec(2000);
            console.log('---- udp num outgoing messages', Object.keys(this._outgoingMessagesWaitingForAcknowledgement).length);
            for (let udpMessageId in this._outgoingMessagesWaitingForAcknowledgement) {
                const x = this._outgoingMessagesWaitingForAcknowledgement[udpMessageId];
                const elapsed = (new Date()) - x.timestamp;
                if (elapsed > 1000) {
                    if (x.numTries >= 3) {
                        console.warn(`Did not get acknowledgement of udp message after ${x.numTries} tries. Canceling.`)
                        delete this._outgoingMessagesWaitingForAcknowledgement[udpMessageId];
                        return;
                    }
                    console.log('--- retrying udp message', udpMessageId);
                    this._prepareAndSendMessage({message: x.message, port: x.port, address: x.address, numTries: x.numTries + 1, udpMessageId});
                }
            }
            for (let udpMessageId in this._handledUdpMessages) {
                const x = this._handledUdpMessages[udpMessageId];
                const elapsed = (new Date()) - x.timestamp;
                if (elapsed > 60000) {
                    delete this._handledUdpMessages[udpMessageId];
                }
            }
        }
    }
}

class UdpConnection {
    constructor({udpServer, connectionId, remoteAddress, remotePort}) {
        this._udpServer = udpServer;
        this._connectionId = connectionId;
        this._remoteAddress = remoteAddress;
        this._remotePort = remotePort;
        this._open = false;
        this._closed = false;
        this._queuedMessages = [];
        this._isUdp = true;

        this._onOpenCallbacks = [];
        this._onCloseCallbacks = [];
        this._onErrorCallbacks = [];
        this._onMessageCallbacks = [];

        this._lastKeepAliveTimestamp = new Date();

        this._start();
    }
    on(name, cb) {
        if (name === 'open') {
            if (this._open) cb();
            this._onOpenCallbacks.push(cb);
        }
        else if (name === 'close') {
            this._onCloseCallbacks.push(cb);
        }
        else if (name === 'error') {
            this._onErrorCallbacks.push(cb);
        }
        else if (name === 'message') {
            this._onMessageCallbacks.push(cb);
        }
    }
    send(message) {
        if (this._closed) return;
        if (!this._open) {
            this._queuedMessages.push(message);
            return;
        }
        const message2 = {
            connectionId: this._connectionId,
            message
        };
        this._udpServer._prepareAndSendMessage({message: message2, port: this._remotePort, address: this._remoteAddress});
    }
    close() {
        if (this._closed) return;
        this._closed = true;
        this._open = false;
        this._onCloseCallbacks.forEach(cb => cb());
    }
    remoteAddress() {
        return this._remoteAddress;
    }
    remotePort() {
        return this._remotePort;
    }
    _handleIncomingMessage(message) {
        if (this._closed) return;
        if (message.type === 'keepAlive') {
            this._lastKeepAliveTimestamp = new Date();
        }
        else {
            this._onMessageCallbacks.forEach(cb => cb(message));
        }
    }
    _setOpen() {
        if (this._open) return;
        if (this._closed) return;
        this._open = true;
        this._onOpenCallbacks.forEach(cb => cb());
        const qm = this._queuedMessages;
        this._queuedMessages = [];
        for (let m of qm) {
            this._sendMessage(m);
        }
    }
    async _start() {
        const delayMsec = 5000;
        while (true) {
            await sleepMsec(delayMsec);
            if (this._closed) {
                return;
            }
            if (this._open) {
                this.send({
                    type: 'keepAlive',
                });
            }
            const elapsed = (new Date()) - this._lastKeepAliveTimestamp;
            if (elapsed > 60000) {
                //console.warn(`Closing udp connection due to inactivity: ${this._connectionId}`);
                this.close();
            }
        }
    }

}

function _udpSocketSend(socket, message, port, address) {
    const messageText = JSONStringifyDeterministic(message);
    socket.send(messageText, port, address, (err, numBytesSent) => {
        if (err) {
            console.warn('Failed to send udp message to remote', {address, port, error: err.message});
            return;
        }
        if (numBytesSent !== messageText.length) {
            console.warn('Problem sending udp message to remote: numBytesSent does not equal expected');
            return;
        }
    });
}

function isValidConnectionId(x) {
    if (!x) return false;
    if (typeof(x) !== 'string') return false;
    if (x.length < 10) return false;
    if (x.length > 20) return false;
    return true;
}

export default InternalUdpServer;