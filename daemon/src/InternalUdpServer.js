import dgram from 'dgram';
import { randomAlphaString, sleepMsec, kacheryP2PDeserialize, kacheryP2PSerialize } from './common/util.js';
import { assert } from 'console';
import { validateObject } from './schema/index.js';
import { JSONStringifyDeterministic } from './common/crypto_util.js';

const MAX_UDP_PACKET_SIZE = 10000;
const TARGET_PCT_LOST_BYTES = 2;


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
        this._socket.on('message', (messageBuffer, remote) => {
            // parse the json message
            let message;
            try {
                message = kacheryP2PDeserialize(messageBuffer);
            }
            catch(err) {
                // console.warn(err);
                // console.warn('Unable to parse udp message', {remote});
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
        const innerC = new InnerUdpConnection({udpServer: this, connectionId, remoteAddress: address, remotePort: port});
        const C = new UdpConnection(innerC);
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
            const innerC = new InnerUdpConnection({
                udpServer: this,
                connectionId: message.connectionId,
                remoteAddress: remote.address,
                remotePort: remote.port
            });
            const C = new UdpConnection(innerC);
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
                    if ((!this._publicEndpoint) || (JSONStringifyDeterministic(this._publicEndpoint) !== JSONStringifyDeterministic(message.initiatorPublicEndpoint))) {
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
    constructor(innerUdpConnection) {
        this._innerUdpConnection = innerUdpConnection;
        this._innerUdpConnection.on('message', messageBuffer => this._handleMessage(messageBuffer))
        this._onMessageCallbacks = [];
        this._pendingIncomingMessages = {};
    }
    send(messageBuffer) {
        const messageBufferParts = this._splitIntoParts(messageBuffer);
        const id = randomAlphaString(10);
        for (let i=0; i<messageBufferParts.length; i++) {
            const part = messageBufferParts[i];
            let headerText = id + ':' + i + ':' + messageBufferParts.length + ':';
            while (headerText.length < 64)
                headerText += ' ';
            const headerBuf = Buffer.from(headerText);
            this._innerUdpConnection.send(Buffer.concat([headerBuf, part]));
        }
    }
    on(name, cb) {
        if (name === 'open') {
            this._innerUdpConnection.on('open', cb);
        }
        else if (name === 'close') {
            this._innerUdpConnection.on('close', cb);
        }
        else if (name === 'error') {
            this._innerUdpConnection.on('error', cb);
        }
        else if (name === 'message') {
            this._onMessageCallbacks.push(cb);
        }
    }
    close() {
        this._innerUdpConnection.close();
    }
    remoteAddress() {
        return this._innerUdpConnection.remoteAddress();
    }
    remotePort() {
        return this._innerUdpConnection.remotePort();
    }
    _setOpen() {
        this._innerUdpConnection._setOpen();
    }
    _handleMessage(messageBuffer) {
        const header = messageBuffer.slice(0, 64).toString('utf-8');
        const buf = messageBuffer.slice(64);
        let vals = header.split(':');
        if (vals.length !== 4) return;
        const id = vals[0];
        if (id.length !== 10) return;
        let i, tot;
        try {
            i = parseInt(vals[1]);
            tot = parseInt(vals[2]);
            assert(i !== NaN);
            assert(tot !== NaN);
        }
        catch(err) {
            return;
        }
        if (i < 0) return;
        if (i >= tot) return;
        if (id in this._pendingIncomingMessages) {
            if (this._pendingIncomingMessages[id].tot !== tot) return;
            if (this._pendingIncomingMessages[id][i]) return;
        }
        else {
            this._pendingIncomingMessages[id] = {tot: tot, numReceived: 0};
        }
        this._pendingIncomingMessages[id][i] = buf;
        this._pendingIncomingMessages[id].numReceived ++;
        if (this._pendingIncomingMessages[id].numReceived === tot) {
            const a = [];
            for (let i=0; i<tot; i++) {
                a.push(this._pendingIncomingMessages[id][i]);
            }
            const reconstructedBuffer = Buffer.concat(a);
            this._onMessageCallbacks.forEach(cb => cb(reconstructedBuffer));
            delete this._pendingIncomingMessages[id];
        }
    }
    _handleIncomingMessage(message) {
        this._innerUdpConnection._handleIncomingMessage(message);
    }
    _splitIntoParts(messageBuffer) {
        const maxPacketSize = MAX_UDP_PACKET_SIZE;
        const ret = [];
        let i = 0;
        while (i < messageBuffer.length) {
            const i2 = Math.min(i + maxPacketSize, messageBuffer.length);
            ret.push(messageBuffer.slice(i, i2));
            i = i2;
        }
        return ret;
    }
}

class InnerUdpConnection {
    constructor({udpServer, connectionId, remoteAddress, remotePort}) {
        this._udpServer = udpServer;
        this._connectionId = connectionId;
        this._remoteAddress = remoteAddress;
        this._remotePort = remotePort;
        this._open = false;
        this._closed = false;
        this._useUdp = true;

        this._queuedMessages = new Queue();
        this._priorityQueuedMessages = new Queue();
        this._unconfirmedMessages = {};
        this._numUnconfirmedMessages = 0;

        this._onOpenCallbacks = [];
        this._onCloseCallbacks = [];
        this._onErrorCallbacks = [];
        this._onMessageCallbacks = [];

        this._lastIncomingMessageTimestamp = new Date();
        this._lastOutgoingMessageTimestamp = new Date();

        this._handledIncomingUdpMessageIds = {};

        this._congestionManager = new UdpCongestionManager();
        this._handleQueuedMessagesScheduled = false;

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
    send(messageBuffer) { // note: this message is a buffer
        if (this._closed) return;

        const x = new Message(messageBuffer);
        this._queuedMessages.enqueue(x);
        this._handleQueuedMessages();
    }
    _handleQueuedMessages() {
        while (true) {
            if (!this._open) return;
            if ((this._priorityQueuedMessages.isEmpty()) && (this._queuedMessages.isEmpty())) {
                return;
            }
            let numBytesNextMessage, delayMsec;
            if (!this._priorityQueuedMessages.isEmpty()) {
                numBytesNextMessage = this._priorityQueuedMessages[0].numBytes();
                delayMsec = this._congestionManager.estimateDelayMsecForNextMessage(numBytesNextMessage);
                if (!delayMsec) {
                    this._sendQueuedMessage(this._priorityQueuedMessages.dequeue());
                }
            }
            else if (!this._queuedMessages.isEmpty()) {
                numBytesNextMessage = this._queuedMessages[0].numBytes();
                delayMsec = this._congestionManager.estimateDelayMsecForNextMessage(numBytesNextMessage);
                if (!delayMsec) {
                    this._sendQueuedMessage(this._queuedMessages.dequeue());
                }
            }

            if (delayMsec) {
                // come back when we estimate we will be ready, if not already scheduled
                if (!this._handleQueuedMessagesScheduled) {
                    this._handleQueuedMessagesScheduled = true;
                    setTimeout(() => {
                        this._handleQueuedMessagesScheduled = false;
                        this._handleQueuedMessages();
                    }, delayMsec + 10);
                }
                return;
            }
        }
    }
    _sendQueuedMessage(x) {
        const message = {
            connectionId: this._connectionId,
            message: {
                type: 'message',
                udpMessageId: x.udpMessageId(),
                messageBuffer: x.messageBuffer()
            }
        };
        _udpSocketSend(this._udpServer._socket, message, this._remotePort, this._remoteAddress);
        x.setSentTimestamp(new Date());
        this._congestionManager.reportMessageSent({numBytes: x.numBytes(), udpMessageId: x.udpMessageId()});
        this._unconfirmedMessages[x.udpMessageId()] = x;
        this._numUnconfirmedMessages ++;
        setTimeout(() => {
            if (x.udpMessageId() in this._unconfirmedMessages) {
                if (x.numTries() >= 6) {
                    // console.warn(`Udp message failed after ${x.numTries()} tries. Closing connection.`);
                    this.close();
                    return; // added on 8/10/20
                }
                x.incrementNumTries();
                this._priorityQueuedMessages.enqueue(x);
                delete this._unconfirmedMessages[x.udpMessageId()];
                this._congestionManager.reportMessageLost({udpMessageId: x.udpMessageId(), numBytes: x.numBytes()});
            }
        }, this._congestionManager.estimatedRoundtripLatencyMsec() * 4);
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
        this._congestionManager.halt();
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

            if ((!message.messageBuffer) || (!(message.messageBuffer instanceof Buffer))) {
                this.close();
                return;
            }
            const isKeepAlive = (Buffer.compare(Buffer.from('udpKeepAlive'), message.messageBuffer) === 0);
            if (!isKeepAlive) {
                this._onMessageCallbacks.forEach(cb => cb(message.messageBuffer));
            }
        }
        else {
            // ignore
        }
    }
    _handleConfirmUdpMessage(udpMessageId) {
        if (udpMessageId in this._unconfirmedMessages) {
            const m = this._unconfirmedMessages[udpMessageId];
            this._congestionManager.reportMessageConfirmed({numBytes: m.numBytes(), roundtripLatencyMsec: (new Date()) - m.sentTimestamp(), udpMessageId: m.udpMessageId()});
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
                    this.send(Buffer.from('udpKeepAlive'));
                }
            }
            const elapsed2 = (new Date()) - this._lastIncomingMessageTimestamp;
            if (elapsed2 > 60000) {
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
    constructor(messageBuffer) {
        this._messageBuffer = messageBuffer;
        this._numTries = 1;
        this._udpMessageId = randomAlphaString(10);
        this._sentTimestamp = null;
    }
    messageBuffer() {
        return this._messageBuffer;
    }
    numBytes() {
        return this._messageBuffer.length;
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
    setSentTimestamp(ts) {
        this._sentTimestamp = ts;
    }
    sentTimestamp() {
        return this._sentTimestamp;
    }
}

class UdpCongestionManager {
    constructor() {
        this._numUnconfirmedMessages = 0; // current number of unconfirmed messages
        this._numUnconfirmedBytes = 0; // current number of unconfirmed bytes

        this._halt = false; // whether the manager has been halted

        this._maxNumBytesPerSecondToSend = 3 * 1000 * 1000; // current number of bytes per second allowed to send
        this._estimatedRoundtripLatencyMsec = 200; // current estimated roundtrip latency

        this._trialDurationMsec = 5000; // duration of a single trial

        // current trial data, see below
        this._currentTrialData = null;
        this._resetTrialData();
        
        // start this manager
        this._start();
    }

    reportMessageSent({numBytes, udpMessageId}) {
        // message has been sent
        this._currentTrialData.sentMessageIds[udpMessageId] = true; // remember the message id
        this._currentTrialData.numSentMessages ++; // increment number of sent messages
        this._currentTrialData.numSentBytes += numBytes; // increment num sent bytes
        
        // update the peak num. unconfirmed bytes (this will help us know whether this trial was testing the limits)
        if (this._currentTrialData.numSentBytes - this._currentTrialData.numConfirmedBytes > this._currentTrialData.peakNumUnconfirmedBytes) {
            this._currentTrialData.peakNumUnconfirmedBytes = this._currentTrialData.numSentBytes - this._currentTrialData.numConfirmedBytes;
        }
    }

    reportMessageLost({numBytes, udpMessageId}) {
        // message has been lost
        // check if it is one of our trial messages
        if (!(udpMessageId in this._currentTrialData.sentMessageIds)) return;

        // increment number of lost messages and num lost bytes
        this._currentTrialData.numLostMessages ++;
        this._currentTrialData.numLostBytes += numBytes;
    }

    reportMessageConfirmed({numBytes, roundtripLatencyMsec, udpMessageId}) {
        // message has been confirmed
        // check if it is one of our trial messages
        if (!(udpMessageId in this._currentTrialData.sentMessageIds)) return;

        // increment number of confirmed messages and bytes
        this._currentTrialData.numConfirmedMessages ++;
        this._currentTrialData.numConfirmedBytes += numBytes;

        // push to our list of roundtrip latencies
        this._currentTrialData.roundtripLatenciesMsec.push(roundtripLatencyMsec);
    }

    estimatedRoundtripLatencyMsec() {
        return this._estimatedRoundtripLatencyMsec;
    }

    estimateDelayMsecForNextMessage(numBytes) {
        // let's estimate how long to delay before sending the next message

        let maxNumBytesPerSecondToSend = this._maxNumBytesPerSecondToSend;
        
        // for debugging
        // maxNumBytesPerSecondToSend = 2 *1000 * 1000;

        // determine how many unconfirmed bytes we are allowed to have at any given moment
        const maxNumUnconfirmedBytesAllowed = maxNumBytesPerSecondToSend / 1000 * this._estimatedRoundtripLatencyMsec;

        // determine current number of outstanding (unconfirmed bytes)
        const numOutstandingBytes = this._currentTrialData.numSentBytes - this._currentTrialData.numConfirmedBytes - this._currentTrialData.numLostBytes;

        // If we have no outstanding bytes, return 0 delay
        if (!numOutstandingBytes) return 0;

        // If we are within allowed range, return 0 delay
        if (numOutstandingBytes + numBytes <= maxNumUnconfirmedBytesAllowed) return 0;

        // How many extra outstanding (unconfirmed) bytes do we have?
        const diffBytes = numOutstandingBytes + numBytes - maxNumUnconfirmedBytesAllowed;

        // Estimate how much do we need to delay in order to catch up
        // num.bytes / (num.bytes / num.sec) * 1000 convert to msec
        const delayMsec = (diffBytes / maxNumBytesPerSecondToSend) * 1000;
        return delayMsec;
    }

    halt() {
        this._halt = true;
    }

    _resetTrialData() {
        this._currentTrialData = {
            timestampStart: new Date(), // timestamp for start of trial period
            sentMessageIds: {}, // ids of all sent messages during trial
            numSentMessages: 0, // num. sent messages during trial
            numConfirmedMessages: 0, // num. confirmed messages during trial
            numLostMessages: 0, // num. presumed lost messages during trial
            numSentBytes: 0, // num. bytes sent during trial
            numConfirmedBytes: 0, // num. bytes confirmed during trial
            numLostBytes: 0, // num. bytes lost during try
            roundtripLatenciesMsec: [], // roundtrip latencies for all messages during trial
            peakNumUnconfirmedBytes: 0 // peak number of outstanding (unconfirmed bytes)
        }
    }
    _adjustCongestionParameters() {
        // get the current trial data
        const {
            timestampStart,
            sentMessageIds,
            numSentMessages,
            numConfirmedMessages,
            numLostMessages,
            numSentBytes,
            numConfirmedBytes,
            numLostBytes,
            roundtripLatenciesMsec,
            peakNumUnconfirmedBytes
        } = this._currentTrialData;

        if (!numSentBytes) {
            // wwe didn't send any bytes. do nothing
            return;
        }

        // whether to print debug info
        const debugUdp = false;
        // const debugUdp = true;
        let doPrint = ((debugUdp) && (numSentBytes > 500 * 1000));
        const elapsedTrialSec = ((new Date()) - timestampStart) / 1000;
        if (doPrint) {
            console.info('[-------------------------------------------------------------------------]');
            console.info(`Sent/conf/lost/%lost: ${numSentMessages}/${numConfirmedMessages}/${numLostMessages}/${((numLostMessages/numSentMessages)*100).toFixed(1)}% [${((numLostBytes/numSentBytes) * 100).toFixed(1)}% lost bytes]`);
            console.info(`Allowed/actual rate (MiB/s): ${(this._maxNumBytesPerSecondToSend / 1000000).toFixed(2)}/${(numConfirmedBytes / elapsedTrialSec / 1000000).toFixed(2)}`);
            console.info(`Est. rt latency: ${this._estimatedRoundtripLatencyMsec}`);
            console.info('[-------------------------------------------------------------------------]');
        }

        // The target of % bytes we want to lose
        const targetPctLostBytes = TARGET_PCT_LOST_BYTES;

        // Percentage of lost bytes
        const pctLostBytes = numLostBytes / numSentBytes * 100;
        if (pctLostBytes < targetPctLostBytes) {
            // didn't lose enough bytes... let's see if we were actually limited
            // calculate the expected peak number of outstanding bytes if we were at full load
            const a = this._maxNumBytesPerSecondToSend / 1000 * this._estimatedRoundtripLatencyMsec;
            if (peakNumUnconfirmedBytes > 0.6 * a) {
                // it looks like we were indeed limited
                // okay, let's increase the rate
                this._maxNumBytesPerSecondToSend *= 1.2;
            }
        }
        else {
            // We lost too many bytes, so let's decrease the rate
            // todo: should we check whether the loss was likely due to rate?
            this._maxNumBytesPerSecondToSend /= 1.2;
        }

        if (pctLostBytes < 20) {
            // don't let the rate get too low
            const lowerBound = 1 * 1000 * 1000;
            if (this._maxNumBytesPerSecondToSend < lowerBound) {
                this._maxNumBytesPerSecondToSend = lowerBound;
            }
        }

        // re-estimate round-trip latency
        if (roundtripLatenciesMsec.length >= 5) {
            // we have enough data to estimate latency

            // adjust the rount trip latency by taking a weighted average of existing estimate with new estimate (median)
            const alpha = 0.3; // how much to weight the new estimate
            this._estimatedRoundtripLatencyMsec = median(this._currentTrialData.roundtripLatenciesMsec) * alpha + this._estimatedRoundtripLatencyMsec * (1 - alpha);

            // constrain the estimate
            const minEstLatency = 20;
            const maxEstLatency = 1000;
            if (this._estimatedRoundtripLatencyMsec < minEstLatency) this._estimatedRoundtripLatencyMsec = minEstLatency;
            if (this._estimatedRoundtripLatencyMsec > maxEstLatency) this._estimatedRoundtripLatencyMsec = maxEstLatency;
        }
    }
    async _startTrials() {
        while (true) {
            this._resetTrialData();
            await sleepMsec(this._trialDurationMsec);
            this._adjustCongestionParameters();
            if (this._halt) return;
        }
    }
    async _start() {
        this._startTrials();
    }
}

function _udpSocketSend(socket, message, port, address) {
    validateObject(message, '/UdpMessage');
    let messageBuffer;
    try {
        messageBuffer = kacheryP2PSerialize(message);
    }
    catch(err) {
        console.warn('Unable to serialize outgoing udp message.')
        return;
    }
    socket.send(messageBuffer, port, address, (err, numBytesSent) => {
        if (err) {
            console.warn('Failed to send udp message to remote', {address, port, error: err.message});
            return;
        }
        if (numBytesSent !== messageBuffer.length) {
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

function median(x) {
    const values = [...x];
    values.sort(function (a, b) { return a - b; });
    var half = Math.floor(values.length / 2);
    if (values.length % 2)
        return values[half];
    else
        return (values[half - 1] + values[half]) / 2.0;
}

export default InternalUdpServer;