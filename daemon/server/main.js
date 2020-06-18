import crypto from 'crypto';
import hyperswarm from 'hyperswarm';
import hypercore from 'hypercore';
import fs from 'fs';
import JsonSocket from 'json-socket';
import ram from 'random-access-memory';
import { exec } from 'child_process';

const daemon_dir = process.env['KACHERY_P2P_DAEMON_DIR'] || undefined;
if (!daemon_dir) {
    console.error('You must set the following environment variable: KACHERY_P2P_DAEMON_DIR');
    process.exit(-1);
}

async function main() {
    const swarmConnectionManager = new SwarmConnectionManager();
    await swarmConnectionManager.joinSwarm('test1');

    const fileSeeker = new FileSeeker(swarmConnectionManager);
    const fileProvider = new FileProvider(swarmConnectionManager);

    const info = await fileSeeker.getFileInfoForSha1('226944af1df1e716284dcd0177922221406ef2fd');
    console.log('INFO:', info);
}

class FileSeeker {
    constructor(swarmConnectionManager) {
        this._swarmConnectionManager = swarmConnectionManager;
        this._start();
    }
    async getFileInfoForSha1(sha1) {
        // Set state.seekingFileInfos[sha1] = true on all swarms
        for (let swarmName of this._swarmConnectionManager.swarmNames()) {
            const swarmConnection = this._swarmConnectionManager.swarmConnection(swarmName);
            const s = swarmConnection.getState();
            swarmConnection.setState({
                ...s,
                seekingFileInfos: {
                    ...s.seekingFileInfos,
                    [sha1]: true
                }
            })
        }
        while (true) {
            // Check for state.fileInfos[sha1] on all peer connections of all swarms
            for (let swarmName of this._swarmConnectionManager.swarmNames()) {
                const swarmConnection = this._swarmConnectionManager.swarmConnection(swarmName);
                for (let id of swarmConnection.peerIds()) {
                    const peerConnection = swarmConnection.peerConnection(id);
                    const ps = peerConnection.getPeerState();
                    if (sha1 in ps.fileInfos) {
                        // Delete state.seekingFileInfos[sha1] = true on all swarms
                        this._removeSeekingFileInfoInSwarms(this._swarmConnectionManager.swarmNames(), sha1);
                        return ps.fileInfos[sha1];
                    }
                }
            }
            await sleepMsec(1000);
        }
    }
    _removeSeekingFileInfoInSwarms(swarmNames, sha1) {
        for (let swarmName of this._swarmConnectionManager.swarmNames()) {
            const swarmConnection = this._swarmConnectionManager.swarmConnection(swarmName);
            const s = swarmConnection.getState();
            swarmConnection.setState({
                ...s,
                seekingFileInfos: removeKey(sha1, s.seekingFileInfos)
            })
        }
    }
    async _start() {
    }
}

class FileProvider {
    constructor(swarmConnectionManager) {
        this._swarmConnectionManager = swarmConnectionManager;
        this._start();
    }
    async _start() {
        while (true) {
            await this._iterate();
            await sleepMsec(1000);
        }
    }    
    async _iterate() {
        // Loop through the swarms
        for (let swarmName of this._swarmConnectionManager.swarmNames()) {
            const swarmConnection = this._swarmConnectionManager.swarmConnection(swarmName);
            // Find all sha1 for which state.seekingFileInfos[sha1] is true on at least one peer
            const beingSaught = {};
            for (let id of swarmConnection.peerIds()) {
                const peerConnection = swarmConnection.peerConnection(id);
                const ps = peerConnection.getPeerState();
                for (let sha1 in (ps.seekingFileInfos || {})) {
                    beingSaught[sha1] = true;
                }
            }
            // For each file info being saught, let's see if we can provide that info
            let newFileInfos = {...swarmConnection.getState().fileInfos};
            for (let sha1 in beingSaught) {
                if (!swarmConnection.getState().fileInfos[sha1]) {
                    const info = await this._loadFileInfo(sha1);
                    if (info) {
                        newFileInfos[sha1] = info;
                    }
                }
            }
            // Let's see which file infos are no longer needed by any peers, and remove them
            for (let sha1 in newFileInfos) {
                if (!(sha1 in beingSaught)) {
                    delete newFileInfos[sha1];
                }
            }
            swarmConnection.setState({
                ...swarmConnection.getState(),
                fileInfos: newFileInfos
            })
        }
    }
    async _loadFileInfo(sha1) {
        let json;
        try {
            json = await executeAndGetStdout(`kachery-info sha1://${sha1}`);
        }
        catch(err) {
            return null;
        }
        let obj;
        try {
            obj = JSON.parse(json);
        }
        catch(err) {
            return null;
        }
        delete obj['path'];
        return obj;
    }
}

class SwarmConnectionManager {
    constructor() {
        this._swarmConnections = {};
    }
    async joinSwarm(swarmName) {
        const swarmConnection = new SwarmConnection(swarmName);
        await swarmConnection.join();
        this._swarmConnections[swarmName] = swarmConnection;
    }
    swarmNames() {
        return Object.keys(this._swarmConnections);
    }
    swarmConnection(swarmName) {
        return this._swarmConnections[swarmName];
    }
}

class SwarmConnection {
    constructor(swarmName) {
        this.id = randomString(10);
        this.swarmName = swarmName;
        this._state = {
            seekingFileInfos: {},
            seekingFiles: {},
            fileInfos: {}
        };
        const key = {
            type: 'kacheryP2PKey',
            swarmName: swarmName
        }
        this.topic = crypto.createHash('sha256')
            .update(JSON.stringify(key))
            .digest()
        this.topicHex = crypto.createHash('sha256')
            .update(JSON.stringify(key))
            .digest('hex')
        this.swarmDir = daemon_dir + '/' + swarmName + '_' + this.topicHex;
        if (!fs.existsSync(this.swarmDir)) {
            fs.mkdirSync(this.swarmDir);
        }
        this.feedDir = this.swarmDir + '/feed';
        if (!fs.existsSync(this.swarmDir)) {
            fs.mkdirSync(this.swarmDir);
        }
        this.feed = null;
        this.swarm = null;
        this._peerConnections = {};
    }
    async join() {
        console.info(`joining swarm: ${this.swarmName} (${this.topicHex})`)
        this.swarm = hyperswarm();
        this.swarm.join(this.topic, {
            lookup: true, // find & connect to peers
            announce: true // optional- announce self as a connection target
        })
        if (false) {
            this.swarm.on('peer', peer => {
                console.info(`${this.swarmName}: Peer discovered: ${peer.host}:${peer.port}${peer.local ? " (local)" : ""}`)
            });
        }
        this.swarm.on('peer-rejected', peer => {
            console.info(`${this.swarmName}: Peer rejected: ${peer.host}:${peer.port}${peer.local ? " (local)" : ""}`)
        });
        this.swarm.on('connection', (socket, details) => {
            const jsonSocket = new JsonSocket(socket);
            const peer = details.peer;
            if (peer) {
                console.info(`${this.swarmName}: Connected to peer: ${peer.host}:${peer.port}${peer.local ? " (local)" : ""}`);
                const peerId = getPeerId(peer);
                // const pc = new PeerConnection(peer, jsonSocket);
                // this._peerConnections[peerId] = pc;
            }

            if (details.client) {
                jsonSocket.sendMessage({from: 'client', id: this.id});
                let receivedServerMessage = false;
                jsonSocket.on('message', msg => {
                    if (receivedServerMessage) return;
                    receivedServerMessage = true;
                    if (!this._peerConnections[msg.id]) {
                        this._peerConnections[msg.id] = new PeerConnection();
                    }
                    this._peerConnections[msg.id].setOutgoingSocket(jsonSocket);
                    this._peerConnections[msg.id].reportState(this._state);
                    this.printInfo();
                });
            }
            else {
                jsonSocket.sendMessage({from: 'server', id: this.id});
                let receivedClientMessage = false;
                jsonSocket.on('message', msg => {
                    if (receivedClientMessage) return;
                    receivedClientMessage = true;
                    if (!this._peerConnections[msg.id]) {
                        this._peerConnections[msg.id] = new PeerConnection();
                    }
                    this._peerConnections[msg.id].setIncomingSocket(jsonSocket);
                    this.printInfo();
                });
            }
        })
        this.swarm.on('disconnection', (socket, info) => {
            const peer = info.peer;
            if (peer) {
                console.info(`${this.swarmName}: Disconnected from peer: ${peer.host}:${peer.port}${peer.local ? " (local)" : ""}`);
                const peerId = getPeerId(peer);
                if (peerId in this._peerConnections) {
                    delete this._peerConnections[peerId];
                }
                this.printInfo();
            }
        })
        this.printInfo();
                
        // you can now use the socket as a stream, eg:
        // process.stdin.pipe(socket).pipe(process.stdout)
    }
    peerIds() {
        return Object.keys(this._peerConnections);
    }
    peerConnection(id) {
        return this._peerConnections[id];
    }
    numPeers() {
        return Object.keys(this._peerConnections).length;
    }
    printInfo() {
        const numPeers = this.numPeers();
        console.info(`${numPeers} ${numPeers === 1 ? "peer" : "peers"}`);
    }
    getState() {
        return this._state;
    }
    setState(state) {
        const newState = {...this._state, ...state};
        if (JSON.stringify(newState) === JSON.stringify(this._state)) return;
        this._state = newState;
        for (let id in this._peerConnections) {
            this._peerConnections[id].reportState(this._state);
        }
    }
}

function getPeerId(peer) {
    return peer.host + ':' + peer.port;
}

class PeerConnection {
    constructor() {
        this._outgoingJsonSocket = null;
        this._incomingJsonSocket = null;
        this._incomingSocketReady = false;
        this._outgoingSocketReady = false;
        this._incomingSocketReadyCallbacks = [];
        this._outgoingSocketReadyCallbacks = [];
        this._peerState = {};
    }
    setIncomingSocket(jsonSocket) {
        this._incomingJsonSocket = jsonSocket;
        this._incomingJsonSocket.on('message', msg => {
            this._handleMessageFromIncomingSocket(msg);
        })
        this._incomingJsonSocket.sendMessage({name: 'ready'});
    }
    setOutgoingSocket(jsonSocket) {
        this._outgoingJsonSocket = jsonSocket;
        this._outgoingJsonSocket.on('message', msg => {
            this._handleMessageFromOutgoingSocket(msg);
        })
        this._outgoingJsonSocket.sendMessage({name: 'ready'});
    }
    _handleMessageFromIncomingSocket(msg) {
        if (msg.name === 'ready') {
            this._incomingSocketReady = true;
        }
        else if (msg.name === 'reportState') {
            this._setPeerState(msg.state);
        }
    }
    _handleMessageFromOutgoingSocket(msg) {
        if (msg.name === 'ready') {
            this._outgoingSocketReady = true;
            for (let cb of this._outgoingSocketReadyCallbacks) {
                cb();
            }
        }
    }
    async _waitForIncomingSocketReady() {
        if (this._incomingSocketReady) return;
        return new Promise((resolve, reject) => {
            this._incomingSocketReadyCallbacks.push(resolve);
        });
    }
    async _waitForOutgoingSocketReady() {
        if (this._outgoingSocketReady) return;
        return new Promise((resolve, reject) => {
            this._outgoingSocketReadyCallbacks.push(resolve);
        });
    }
    async reportState(state) {
        await this._waitForOutgoingSocketReady();
        this._outgoingJsonSocket.sendMessage({
            name: 'reportState',
            state
        })
    }
    getPeerState() {
        return this._peerState;
    }
    _setPeerState(state) {
        this._peerState = state;
        console.log('--- peer state', this._peerState);
    }
}

function randomString(num_chars) {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (var i = 0; i < num_chars; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}

const sleepMsec = m => new Promise(r => setTimeout(r, m));

const removeKey = (k, { [k]:_, ...others }) => others;

const executeAndGetStdout = async (command) => {
    return new Promise((resolve, reject) => {
        exec(command, function(error, stdout, stderr) {
            if (error) {
                reject(error);
                return;
            }
            resolve(stdout);
        });
    });
}

main();