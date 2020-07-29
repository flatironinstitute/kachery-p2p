import { sleepMsec } from '../common/util.js'

class BootstrapPeerManager {
    constructor(node, {address, port}) {
        this._node = node;
        this._address = address;
        this._port = port;
        this._connected = false;
        this._peerId = null; // to be determined

        this._start();
    }

    _checkConnected() {
        // todo - finish this
        if (!this._connected) return false;
        if (this._peerId in this._node._peers) {
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
            C = await this._node._websocketServer.createOutgoingWebsocketConnection({
                address: this._address,
                port: this._port,
                remoteNodeId: null // we don't know it yet
            });
        }
        catch(err) {
            // console.warn(`Problem creating outgoing connection to bootstrap peer. ${err.message}`);
            return false;
        }
        if (!C) {
            console.warn(`Unable to connect to bootstrap peer: ${address}:${port}`);
            return false;
        }
        const remoteNodeId = C.remoteNodeId();
        if (!(remoteNodeId in this._node._peers)) {
            this._node._createPeer(remoteNodeId);
        }
        const P = this._node._peers[remoteNodeId];
        if (!P) {
            console.warn('Problem connecting to bootstrap peer.');
            C.disconnect();
            return false;
        }
        P.setOutgoingConnection({type: 'websocket', connection: C});
        P.setIsBootstrapPeer(true, {address: this._address, port: this._port});
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