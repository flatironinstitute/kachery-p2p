import { randomString } from './util.js';
import fs from 'fs';

class PeerConnection {
    constructor({swarmName, peerId}) {
        this._swarmName = swarmName;
        this._peerId = peerId;

        this._incomingJsonSocket = null;
        this._outgoingJsonSocket = null;

        this._incomingSocketReady = false;
        this._outgoingSocketReady = false;

        this._incomingSocketReadyCallbacks = [];
        this._outgoingSocketReadyCallbacks = [];

        this._connectionInfo = {};
        this._outgoingFileRequests = [];
        this._incomingFileRequests = [];

        this._waitForMessageTestFunctions = {};
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
    async _handleMessage(msg) {
        if (msg.type === 'requestFile') {
            // the peer is requesting a file

            const requestId = msg.requestId;
            const kacheryPath = msg.kacheryPath;
            const opts = msg.opts;

            const handleAccept = (info) => {
                // Accept the peer's request for a file
                if (incomingFileRequest.status !== 'pending') {
                    console.warn(`Cannot accept. Unexpected incoming file request status: ${incomingFileRequest.status}`);
                    return;
                }
                incomingFileRequest.status = 'accepted-pending';
                this.sendMessage({
                    type: 'acceptFileRequest',
                    requestId: requestId,
                    sizeBytes: info.sizeBytes
                })
            }
            const handleDecline = () => {
                if (incomingFileRequest.status !== 'pending') {
                    console.warn(`Cannot accept for this incoming file request status: ${incomingFileRequest.status}`);
                    return;
                }
                incomingFileRequest.status = 'declined';
                this.sendMessage({
                    type: 'declineFileRequest',
                    requestId: requestId
                })
            }
            const handleCancel = () => {
                if ((incomingFileRequest.status !== 'accepted-pending') && (incomingFileRequest.status !== 'accepted-uploading')) {
                    console.warn(`Cannot cancel for this incoming file request status: ${incomingFileRequest.status}`);
                    return;
                }
                // TODO: stop the upload if needed
                incomingFileRequest.status = 'canceled';
                this.sendMessage({
                    type: 'cancelAcceptedFileRequest',
                    requestId: requestId
                })
            }
            const incomingFileRequest = {
                requestId: requestId,
                swarmName: this._swarmName,
                peerId: this._peerId,
                kacheryPath: kacheryPath,
                opts: opts,
                status: 'pending',
                timestampReceived: (new Date()) - 0,
                accept: handleAccept,
                decline: handleDecline,
                cancel: handleCancel
            }
            this._incomingFileRequests.push(incomingFileRequest);
        }
        else if (msg.type === 'acceptFileRequest') {
            // Peer has accepted a file request that we made
            const requestId = msg.requestId;
            const outgoingFileRequest = this._outgoingFileRequests.filter(r => (r.requestId === requestId))[0];
            if (!outgoingFileRequest) {
                // unexpected
                return;
            }
            const handleAcceptOffer = () => {
                const asyncHelper = async () => {
                    // We are accepting an offer from the peer to send us a file
                    if (outgoingFileRequest.status !== 'pending') {
                        // unexpected
                        return;
                    }
                    if (offer.status !== 'pending') {
                        // unexpected
                        return;
                    }
                    outgoingFileRequest.status = 'downloading';
                    offer.status = 'accepted-pending';
                    try {
                        await this._downloadFileFromPeer(outgoingFileRequest, offer);
                    }
                    catch(err) {
                        console.error('Problem with file download from peer.');
                        offer.status = 'error';
                        return;
                    }
                    if (outgoingFileRequest.status !== 'downloading') {
                        // unexpected
                    }
                    outgoingFileStatus = 'finished';
                    offer.status = 'finished';
                    for (let cb of offer._onFinishedCallbacks) {
                        cb();
                    }
                }
                asyncHelper();
            }
            const handleDeclineOffer = () => {
                if (offer.status !== 'pending') {
                    // unepected
                    return
                }
                offer.status = 'declined';
            }
            const handleCancelAcceptedOffer = () => {
                offer.status = 'canceled';
            }
            const onOfferFinished = (callback) => {
                offer._onFinishedCallbacks.push(callback);
            }
            const handleCancelOfferByPeer = () => {
                offer.status = 'canceled-by-peer';
            }
            const offer = {
                swarmName: this._swarmName,
                peerId: this._peerId,
                status: 'pending',
                timestampReceived: (new Date()) - 0,
                timestampAccepted: null,
                sizeBytes: msg.sizeBytes,
                progressBytes: 0,
                accept: handleAcceptOffer,
                decline: handleDeclineOffer,
                cancel: handleCancelAcceptedOffer,
                onFinished: onOfferFinished,
                cancelByPeer: handleCancelOfferByPeer,
                _onFinishedCallbacks: []
            }
            outgoingFileRequest.offers.push(offer);
        }
        else if (msg.type === 'declineFileRequest') {
            // Peer has declined a file request that we made
            const requestId = msg.requestId;
            const outgoingFileRequest = this._outgoingFileRequests.filter(r => (r.requestId === requestId))[0];
            if (!outgoingFileRequest) {
                // unexpected
                return;
            }
            // Don't do anything... just don't append an offer
        }
        else if (msg.type === 'cancelAcceptedFileRequest') {
            // Peer is canceling an offer made previously for a file request that we made
            const requestId = msg.requestId;
            const outgoingFileRequest = this._outgoingFileRequests.filter(r => (r.requestId === requestId))[0];
            if (!outgoingFileRequest) {
                // unexpected
                return;
            }
            const offers = outgoingFileRequest.offers.filter(o => (o.peerId === this._peerId));
            for (let offer of offers) {
                offer.cancelByPeer();
            }
            outgoingFileRequest.offers = outgoingFileRequest.offers.filter(o => (o.peerId !== this._peerId));
        }
        else if (msg.type === 'acceptOffer') {
            // Peer has accepted an offer for us to provide a file that the peer requested
            // So we are going to send the data
            const requestId = msg.requestId;
            const incomingFileRequest = this._incomingJsonSocket.filter(r => (r.requestId === requestId))[0];
            if (!incomingFileRequest) {
                // unexpected
                // TODO: send error message back to the peer
                return;
            }
            if (incomingFileRequest.status !== 'accepted-pending') {
                // we did not accept this request. Maybe we need to ban the peer.
                return;
            }
            incomingFileRequest.status = 'accepted-uploading'
            let x;
            try {
                x = await _kacheryLoadFile(incomingFileRequest.kacheryPath);
            }
            catch(err) {
                // todo: report error to peer
                console.warn(`Problem loading file: ${incomingFileRequest.kacheryPath}`)
                return;
            }
            await this.asyncSendMessage({
                type: 'fileData',
                requestId: requestId,
                data_b64: x.toString('base64')
            })
            incomingFileRequest.status = 'finished'
        }
        else {
            for (let id in this._waitForMessageTestFunctions) {
                const x = this._waitForMessageTestFunctions[id];
                const testFunction = x[0];
                const cb = x[1];
                if (testFunction(msg)) {
                    cb();
                    return;
                }
            }
        }
    }
    asyncSendMessage = async (msg) => {
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
        console.log('--- sending message', msg);
        socket.sendMessage(msg);
    }
    sendMessage(msg) {
        this.asyncSendMessage(msg);
    }
    addOutgoingFileRequest(outgoingFileRequest) {
        this.sendMessage({
            type: 'requestFile',
            requestId: outgoingFileRequest.requestId,
            kacheryPath: outgoingFileRequest.kacheryPath,
            opts: outgoingFileRequest.opts,
        })
        this._outgoingFileRequests.push(outgoingFileRequest);
    }
    setConnectionInfo(info) {
        this._connectionInfo = info;
    }
    connectionInfo() {
        return this._connectionInfo;
    }
    getIncomingFileRequests() {
        return this._incomingFileRequests;
    }
    disconnect() {
        if (this._incomingJsonSocket) {
            this._incomingJsonSocket._socket.destroy();
        }
        if (this._outgoingJsonSocket) {
            this._outgoingJsonSocket._socket.destroy();
        }
    }
    async _downloadFileFromPeer(outgoingFileRequest, offer) {
        // Download a file from peer by accepting an offer they gave to provide a file that we had requested
        await this.asyncSendMessage({
            type: 'acceptOffer',
            requestId: outgoingFileRequest.requestId
        })
        const testFunction = msg => (msg.requestId === outgoingFileRequest.requestId);
        while (true) {
            const msg = await this._waitForMessage(testFunction, {timeoutMsec: 10000});
            if (!msg) {
                console.warn('Timeout waiting for download.');
                offer.status = 'error';
                return;
            }
            if (msg.type === 'fileData') {
                const buf = Buffer.from(msg.data_b64, 'base64');
                const tmpdir = _getTemporaryDirectory();
                const path = `${tmpdir}/kachery-p2p-download.${randomString(6)}.download`;
                const writeFile = util.promisify(fs.writeFile);
                await writeFile(path, buf);
                await _kacheryStoreWithHardLink(path);
                fs.unlinkSync(path);
                offer.status = 'finished';
                return;
            }
        }
    }
    async _waitForMessage(testFunction) {
        return new Promise((resolve, reject) => {
            const tmpId = randomString(10);
            const cb = (msg) => {
                delete this._waitForMessageTestFunctions[tmpId];
                resolve(msg);
            }
            this._waitForMessageTestFunctions[tmpId] = [testFunction, cb];
        });
    }
}

export default PeerConnection;