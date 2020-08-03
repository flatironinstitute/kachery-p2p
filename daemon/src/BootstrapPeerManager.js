import { sleepMsec } from './common/util.js'
import { OutgoingConnectionError } from './WebsocketServer.js';

class BootstrapPeerManager {
    constructor({remoteNodeManager, websocketServer, address, port}) {
        this._remoteNodeManager = remoteNodeManager;
        this._websocketServer = websocketServer;
        this._address = address;
        this._port = port;
        this._connected = false;
        this._peerId = null; // to be determined
        this._printedError = false;

        this._start();
    }

    _checkConnected() {
        if (!this._connected) return false;
        if (this._remoteNodeManager.isPeer(this._peerId)) {
            return true;
        }
        this._peerId = null;
        this._connected = false;
        return false;
    }
    async _tryToConnect() {
        if (this._connected) return;
        let C;
        try {
            C = await this._websocketServer.createOutgoingConnection({
                address: this._address,
                port: this._port,
                remoteNodeId: null // we don't know it yet
            });
        }
        catch(err) {
            if (!this._printedError) {
                if (err instanceof OutgoingConnectionError) {
                    console.warn(`
Error connecting to bootstrap node ${this._address}:${this._port}:
${err.message}
                    `)
                    if (!err.message.includes('Cannot connect to self')) {
                        console.warn(`

You may need to update to the latest version of kachery-p2p
(perhaps the bootstrap node is on a more recent version). You
could also manually specify your own bootstrap node.
                        `)
                    }
                }
                else {
                    // console.warn(err);
                    console.warn(`Unable to connect to bootstrap node ${this._address}:${this._port}: ${err.message}`);
                }
                this._printedError = true;
            }
            return false;
        }
        if (!C) {
            if (!this._printedError) {
                console.warn(`Unable to connect to bootstrap node: ${this._address}:${this._port}`);
                this._printedError = true;
            }
            return false;
        }
        console.info(`Connected to bootstrap node: ${this._address}:${this._port}`);
        this._printedError = false;
        const remoteNodeId = C.remoteNodeId();
        this._remoteNodeManager.setOutgoingConnection({
            nodeId: remoteNodeId,
            type: 'websocket',
            connection: C
        });
        this._remoteNodeManager.setRemoteNodeBootstrapPeerInfo(
            remoteNodeId,
            {address: this._address, port: this._port}
        )
        this._connected = true;
        this._peerId = remoteNodeId;
        return true;
    }

    async _start() {
        // start out with aggressive attempts and get slower if we fail
        let delayMsec = 1000;

        while (true) {
            await sleepMsec(delayMsec);
            if (this._checkConnected()) {
                delayMsec = 1000;
            }
            else {
                await this._tryToConnect();
                if (!this._checkConnected()) {
                    delayMsec *= 2; // slow down the frequency of the checks if we fail
                    if (delayMsec > 30000)
                        delayMsec = 30000; // try every 30 seconds, ultimately
                }
            }
        }
    }
}

export default BootstrapPeerManager;