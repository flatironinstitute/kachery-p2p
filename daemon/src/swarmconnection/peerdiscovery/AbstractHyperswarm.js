import hyperswarm from 'hyperswarm';
import JsonSocket from 'json-socket';
import { log } from '../../common/log.js';

class AbstractHyperswarm {
    constructor(topic) {
        this._topic = topic;
        this._onConnectionCallbacks = [];

        this._hyperswarm = hyperswarm({
            forget: {
                // how long to wait before forgetting that a peer
                // has become unresponsive
                unresponsive: 20,
                // how long to wait before fogetting that a peer
                // has been banned
                banned: 60
            },
            multiplex: true,
            preferredPort: 44500
        });
        this._hyperswarm.join(this._topic, {
            lookup: true, // find & connect to peers
            announce: true // announce self as a connection target
        })
        // this._hyperswarm.on('peer', peer => {
        //     console.info(`${this._swarmName}: Peer discovered: ${peer.host}:${peer.port}${peer.local ? " (local)" : ""}`)
        // });
        this._hyperswarm.on('peer-rejected', peer => {
            log('discovery').info(`Peer rejected`, {host: peer.host, port: peer.port, local: peer.local});
        });

        this._hyperswarm.on('connection', (socket, details) => {
            // safe
            let jsonSocket;
            try {
                jsonSocket = new JsonSocket(socket);
            }
            catch(err) {
                log('discovery').warning('Problem creating JsonSocket. Closing socket.');
                socket.destroy();
                return;
            }
            jsonSocket._socket = socket;
            const peer = details.peer;
            if (peer) {
                log('discovery').info(`Connecting to peer`, {host: peer.host, port: peer.port, local: peer.local});
                // const pc = new PeerConnection(peer, jsonSocket);
                // this._peerConnections[peerId] = pc;
            }

            this._onConnectionCallbacks.forEach(cb => {
                cb(jsonSocket, socket, details);
            })
        });
        this._hyperswarm.on('disconnection', (socket, info) => {
            // safe
            const peer = info.peer;
            if (peer) {
                log('discovery').info(`Disconnecting from peer`, {host: peer.host, port: peer.port, local: peer.local});
            }
        })
        this._hyperswarm.on('error', (err) => {
            // This is not documented in hyperswarm, but might be needed, not sure
            log('discovery').warning('Hyperswarm error: ', {error: err.message});
        })
    }
    onConnection(cb) {
        this._onConnectionCallbacks.push(cb);
    }
    leave() {
        this._hyperswarm.leave(this._topic);
    }
}

export default AbstractHyperswarm;