import SwarmConnection from './SwarmConnection.js'

/*
    
-----------------------------------------------
Each incoming request has the following format:
{
    requestId: 'unique-id',
    swarmName: 'name-of-the-swarm',
    peerId: 'unique-id-of-the-peer-node',
    kacheryPath: 'sha1://path or similar',
    opts: {
        infoOnly: false
        start: null,
        end: null
    },
    status: 'pending', // see below
    timestampReceived: null,
    timestampAccepted: null,
    accept: function, // pass in info={sizeBytes: expected-size-of-transfer}
    decline: function,
    cancel: function
}
Status:
    pending: waiting for accept/decline
    accepted-pending: accepted but waiting for response from peer
    accepted-uploading: accepted and uploading
    error
    declined
    canceled
    canceled-by-peer

-----------------------------------------------
Each outgoing request has the following format:
{
    requestId: 'unique-id',
    kacheryPath: 'sha1://path or similar',
    opts: {
        infoOnly: false
        start: null,
        end: null
    },
    status: 'pending', // pending, downloading, finished, canceled
    offers: [
        {
            offerId: 'unique-id',
            swarmName: 'name-of-the-swarm',
            peerId: 'id-of-the-peer-making-the-offer',
            status: 'pending', // see below
            timestampReceived: null,
            sizeBytes: null, // expected size of the response
            progressBytes: null, // number of bytes downloaded already
            accept: function,
            decline: function,
    localPath: path-of-locally-downloaded-file
            cancel: function,
            onFinished: function(cb) {...} // callback with be called when the accepted offer completes (err, result)
        }, ...
    ]
}
result in the callback:
{
    kacheryPath: 'as-provided',
    opts: 'as-provided',
    fileInfo: ...if requested...
}
Status for offer:
    pending: waiting for accept/decline
    accepted-pending: accepted but waiting for response from peer
    accepted-downloading: accepted and downloading
    finished
    error
    rejected
    canceled
    canceled-by-peer
*/

class Daemon {
    constructor() {
        this._swarmConnections = {};
    }

    /*****************************************************************************
    API
    ******************************************************************************/
    
    // swarms
    joinSwarm = async (swarmName) => await this._joinSwarm(swarmName);
    leaveSwarm = (swarmName) => this._leaveSwarm(swarmName);
    getSwarms = () => (this._getSwarms());

    // Incoming file requests from peers (see above)
    getIncomingFileRequests = () => this._getIncomingFileRequests();

    // Make an outgoing file request
    requestFile = (swarmName, kacheryPath, opts) => (this._requestFile(swarmName, kacheryPath, opts));

    // Outgoing file requests (see above)
    getOutgoingFileRequests = () => (this._getOutgoingFileRequests());

    // peers
    getPeers = () => (this._getPeers());
    disconnectPeer = (swarmName, peerId) => (this._disconnectPeer(swarmName, peerId));

    /*****************************************************************************
    IMPLEMENTATION
    ******************************************************************************/

    _joinSwarm = async (swarmName) => {
        if (swarmName in this._swarmConnections) {
            console.warn(`Cannot join swarm. Already joined: ${swarmName}`);
            return;
        }
        this._swarmConnections[swarmName] = new SwarmConnection(swarmName);
        await this._swarmConnections[swarmName].join();
    }
    _leaveSwarm = (swarmName) => {
        if (!(swarmName in this._swarmConnections)) {
            console.warn(`Cannot leave swarm. Not joined: ${swarmName}`);
            return;
        }
        this._swarmConnections[swarmName].leave();
        delete this._swarmConnections[swarmName];
    }
    _getSwarms = () => {
        const swarmNames = Object.keys(this._swarmConnections);
        return swarmNames.map((swarmName) => (
            {
                swarmName: swarmName
                // other info? num. peers?
            }
        ));
    }

    _getIncomingFileRequests = () => {
        let ret = [];
        for (let swarmName in this._swarmConnections) {
            const x = this._swarmConnections[swarmName].getIncomingFileRequests();
            ret = [...ret, ...x];
        }
        return ret;
    }

    ///////////////////////////xxxxxxxxxxxxxxxxxxxxxxxxxx

    _requestFile = (swarmName, kacheryPath, opts) => {
        if (!(swarmName in this._swarmConnections)) {
            console.warn(`Cannot request file from swarm. Not joined: ${swarmName}`);
            return;
        }
        this._swarmConnections[swarmName].requestFile(kacheryPath, opts);
    }

    _getOutgoingFileRequests = () => {
        let ret = [];
        for (let swarmName in this._swarmConnections) {
            const x = this._swarmConnections[swarmName].getOutgoingFileRequests();
            ret = [...ret, ...x];
        }
        return ret;
    }

    _getPeers = () => {
        let ret = [];
        for (let swarmName in this._swarmConnections) {
            let peerIds = this._swarmConnections[swarmName].peerIds();
            for (let peerId of peerIds) {
                const peerConnection = this._swarmConnections[swarmName].peerConnection(peerId);
                ret.push({
                    swarmName,
                    peerId,
                    connectionInfo: peerConnection.connectionInfo()
                })
            }
        }
        return ret;
    }
    _disconnectPeer = (swarmName, peerId) => {
        if (!(swarmName in this._swarmConnections)) {
            console.warn(`Cannot disconnect peer in swarm. Not joined: ${swarmName}`);
            return;
        }
        this._swarmConnections[peerId].disconnectPeer(peerId);
    }
}

export default Daemon;