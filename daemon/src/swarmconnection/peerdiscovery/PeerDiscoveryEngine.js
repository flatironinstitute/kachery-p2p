import HyperswarmConnection from './HyperswarmConnection';
import { sleepMsec } from '../util';

class PeerDiscoveryEngine {
    constructor({keypair, swarmName, nodeId, host, port, verbose}) {
        this._keypair = keypair;
        this._swarmName = swarmName;
        this._nodeId = nodeId;
        this._host = host;
        this._port = port;
        this._verbose = verbose;
        this._hyperswarmConnection = new HyperswarmConnection({keypair, swarmName, nodeId, verbose});
        this._onPeerAnnounceCallbacks = [];
        this._halt = false;

        this._hyperswarmConnection.onMessage((fromNodeId, msg) => {
            if (msg.type === 'announce') {
                if (msg.nodeId !== fromNodeId) {
                    console.warn('Unexpected: msg.nodeId <> fromNodeId', msg.nodeId, fromNodeId);
                    return;
                }
                this._onPeerAnnounceCallbacks.forEach(cb => {
                    cb({peerId: fromNodeId, host: msg.host, port: msg.port, local: this._hyperswarmConnection.peerIsLocal(fromNodeId)});
                });
            }
        });

        this._start();
    }
    // cb({nodeId, ip, port})
    onPeerAnnounce(cb) {
        this._onPeerAnnounceCallbacks.push(cb);
    }
    leave() {
        this._halt = true;
    }
    async _start() {
        await sleepMsec(1000);
        while (true) {
            if (this._halt) return;
            this._hyperswarmConnection.broadcastMessage({
                type: 'announce',
                nodeId: this._nodeId,
                host: this._host,
                port: this._port
            })
            await sleepMsec(3000);
        }
    }
}

export default PeerDiscoveryEngine;