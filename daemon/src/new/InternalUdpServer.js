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
        
        const socket = dgram.createSocket('udp4');
        if (port)
            socket.bind(port, '');
        else
            socket.bind();
        socket.on('listening', () => {
            // console.info('Udp socket', socket.address());
        });
        this._socket = socket;
        this._socket.on('message', (messageTxt, remote) => {
            // parse the json message
            let message;
            try {
                message = JSON.parse(messageTxt);
            }
            catch {
                console.warn('Unable to parse udp message', {remote});
                return;
            }

            this._handleIncomingMessage(message, remote);
        });

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
        _udpSocketSend(this._socket, openMessage, port, address);
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
            _udpSocketSend(this._socket, acceptMessage, remote.port, remote.address);
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

    async _start() {
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
        this._useUdp = true;

        this._onOpenCallbacks = [];
        this._onCloseCallbacks = [];
        this._onErrorCallbacks = [];
        this._onMessageCallbacks = [];

        this._lastIncomingMessageTimestamp = new Date();
        this._lastOutgoingMessageTimestamp = new Date();

        this._handledIncomingUdpMessageIds = {};

        this._queuedMessages = new Queue();
        this._priorityQueuedMessages = new Queue();
        this._unconfirmedMessages = {};
        this._numUnconfirmedMessages = 0;
        this._maxNumUnconfirmedMessages = 1; // adaptive - determines the speed of transmission
        this._thresh = 1; // determines how we increase the maxNumUnconfirmedMessage whenever we receive confirmation

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
    send(messageText) { // note: this message is text
        if (this._closed) return;

        const x = new Message(messageText);
        this._queuedMessages.enqueue(x);
        this._handleQueuedMessages();
    }
    _handleQueuedMessages() {
        while (true) {
            if (this._numUnconfirmedMessages >= this._maxNumUnconfirmedMessages) {
                return;
            }
            if ((this._priorityQueuedMessages.isEmpty()) && (this._queuedMessages.isEmpty())) {
                return;
            }
            if (!this._priorityQueuedMessages.isEmpty()) {
                this._sendQueuedMessage(this._priorityQueuedMessages.dequeue());
            }
            else if (!this._queuedMessages.isEmpty()) {
                this._sendQueuedMessage(this._queuedMessages.dequeue());
            }
        }
    }
    _handleMessageFail() {
        this._thresh = this._maxNumUnconfirmedMessages / 2;
        if (this._thresh < 1)
            this._thresh = 1;
        this._maxNumUnconfirmedMessages = this._thresh;
        this._handleQueuedMessages();
    }
    _sendQueuedMessage(x) {
        const message = {
            connectionId: this._connectionId,
            message: {
                type: 'message',
                udpMessageId: x.udpMessageId(),
                messageText: x.messageText()
            }
        };
        _udpSocketSend(this._udpServer._socket, message, this._remotePort, this._remoteAddress);
        this._unconfirmedMessages[x.udpMessageId()] = x;
        this._numUnconfirmedMessages ++;
        setTimeout(() => {
            if (x.udpMessageId() in this._unconfirmedMessages) {
                if (x.numTries() >= 5) {
                    console.warn(`Udp message failed after ${x.numTries()} tries. Closing connection.`);
                    this.close();
                }
                x.incrementNumTries();
                this._priorityQueuedMessages.enqueue(x);
                delete this._unconfirmedMessages[x.udpMessageId()];
                this._handleMessageFail();
            }
        }, 2000);
    }
    close() {
        if (this._closed) return;
        const closeMessage = {
            connectionId: this._connectionId,
            message: {
                type: 'close'
            }
        };
        _udpSocketSend(this._udpServer._socket, closeMessage, this._remotePort, this._remoteAddress);
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

        this._lastIncomingMessageTimestamp = new Date();

        if (message.type === 'confirmUdpMessage') {
            this._handleConfirmUdpMessage(message.udpMessageId);
            return;
        }
        else if (message.type === 'close') {
            this.close();
            return;
        }
        else if (message.type === 'message') {
            if (!message.udpMessageId) {
                return;
            }
            const udpMessageId = message.udpMessageId;
            // Note: it's important to confirm receipt before checking if we already handled it
            // that's because maybe the confirmation was lost the last time
            const confirmMsg = {
                connectionId: this._connectionId,
                message: {
                    type: 'confirmUdpMessage',
                    udpMessageId
                }
            };
            _udpSocketSend(this._udpServer._socket, confirmMsg, this._remotePort, this._remoteAddress);

            if (udpMessageId in this._handledIncomingUdpMessageIds) {
                return;
            }
            this._handledIncomingUdpMessageIds[udpMessageId] = {timestamp: new Date()};

            if (message.messageText !== 'udpKeepAlive') {
                this._onMessageCallbacks.forEach(cb => cb(message.messageText));
            }
        }
        else {
            // ignore
        }
    }
    _handleConfirmUdpMessage(udpMessageId) {
        if (udpMessageId in this._unconfirmedMessages) {
            delete this._unconfirmedMessages[udpMessageId];
            this._numUnconfirmedMessages --;
            if (this._thresh === 0) {
                this._maxNumUnconfirmedMessages ++;
                if (this._maxNumUnconfirmedMessages > 20) {
                    this._maxNumUnconfirmedMessages = 20;
                }
            }
            else {
                this._maxNumUnconfirmedMessages += 1/this._thresh;
            }
            this._handleQueuedMessages();
        }
    }
    _setOpen() {
        if (this._open) return;
        if (this._closed) return;
        this._open = true;
        this._onOpenCallbacks.forEach(cb => cb());
        this._handleQueuedMessages();
    }
    async _startCleanup() {
        while (true) {
            await sleepMsec(3000);
            // avoid memory leak
            for (let udpMessageId in this._handledIncomingUdpMessageIds) {
                const x = this._handledIncomingUdpMessageIds[udpMessageId];
                const elapsed = (new Date()) - x.timestamp;
                if (elapsed > 60000) {
                    delete this._handledIncomingUdpMessageIds[udpMessageId];
                }
            }
            if (this._closed) return;
        }
    }
    async _startKeepAlive() {
        const delayMsec = 1000;
        while (true) {
            if (this._closed) {
                return;
            }
            await sleepMsec(delayMsec);
            const elapsed1 = (new Date()) - this._lastOutgoingMessageTimestamp;
            if (elapsed1 > 5000) {
                if (this._open) {
                    this.send('udpKeepAlive');
                }
            }
            const elapsed2 = (new Date()) - this._lastIncomingMessageTimestamp;
            if (elapsed2 > 15000) {
                //console.warn(`Closing udp connection due to inactivity: ${this._connectionId}`);
                this.close();
            }
        }
    }
    
    async _start() {
        this._startKeepAlive();
        this._startCleanup();
    }
}

class Message {
    constructor(messageText) {
        this._messageText = messageText;
        this._numTries = 1;
        this._udpMessageId = randomAlphaString(10);
    }
    messageText() {
        return this._messageText;
    }
    numTries() {
        return this._numTries;
    }
    incrementNumTries() {
        this._numTries ++;
    }
    udpMessageId() {
        return this._udpMessageId;
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

class Queue extends Array {
    enqueue(val) {
        this.push(val);
    }

    dequeue() {
        return this.shift();
    }

    peek() {
        return this[0];
    }

    isEmpty() {
        return this.length === 0;
    }
}

function isValidConnectionId(x) {
    if (!x) return false;
    if (typeof(x) !== 'string') return false;
    if (x.length < 10) return false;
    if (x.length > 20) return false;
    return true;
}

export default InternalUdpServer;