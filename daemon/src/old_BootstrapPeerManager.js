import { sleepMsec } from './common/util'
import { OutgoingConnectionError } from './SocketServer.js';
import { validateObject, validateSha1Hash, validateNodeData, validateNodeId, validatePort } from './schema/index.js';
import RemoteNodeManager from './RemoteNodeManager';

class BootstrapPeerManager {
    constructor({remoteNodeManager, websocketServer, address, port}) {
        validateObject(address, '/Address');
        validatePort(port);
        this._remoteNodeManager = remoteNodeManager;
        this._node = remoteNodeManager._node;
        this._websocketServer = websocketServer;
        this._address = address;
        this._port = port;
        this._connected = false;
        this._peerId = null; // to be determined
        this._printedError = false;
        this._halt = false;

        this._start();
    }

    peerId() {
        return this._peerId;
    }
    handleFindChannelPeersResponse(message) {
        validateObject(message, '/FindChannelPeersResponseMessage');

        const transformedChannelName = message.transformedChannelName;
        const nodes = message.nodes;

        validateSha1Hash(transformedChannelName);

        let channelName = null;
        for (let ch in this._node._channels) {
            if (this._node._gettransformedChannelNameForDiscovery({channelName: ch, nodeId: this._peerId}) === transformedChannelName) {
                channelName = ch;
            }
        }

        for (let data0 of nodes) {
            validateNodeData(data0);
            const nodeId = data0.body.nodeInfo.nodeId;
            validateNodeId(nodeId);
            this._remoteNodeManager.setRemoteNodeData(nodeId, data0);
            if (channelName) {
                // this is tricky... we store it based on transformed for our own id
                this._remoteNodeManager.associateNodeWithTransformedChannelName({
                    nodeId,
                    transformedChannelName: this._node._gettransformedChannelNameForDiscovery({channelName, nodeId: this._node._nodeId})
                });
            }
        }
    }
    halt() {
        this._halt = true;
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
        // console.info(`Connected to bootstrap node: ${this._address}:${this._port}`);
        this._printedError = false;
        const remoteNodeId = C.remoteNodeId();
        this._remoteNodeManager.setOutgoingConnection({
            nodeId: remoteNodeId,
            type: 'websocket',
            connection: C
        });
        const bootstrapPeerInfo = {
            address: this._address,
            port: this._port
        };
        validateObject(bootstrapPeerInfo, '/BootstrapPeerInfo');
        this._remoteNodeManager.setRemoteNodeBootstrapPeerInfo(
            remoteNodeId,
            bootstrapPeerInfo
        );
        this._connected = true;
        this._peerId = remoteNodeId;
        return true;
    }

    async _startTryingToConnect() {
        // start out with aggressive attempts and get slower if we fail
        let delayMsec = 1000;

        while (true) {
            await sleepMsec(delayMsec);
            if (this._halt) return;
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

    async _startFindingChannelPeers() {
        // start out with aggressive attempts after connecting and get slower
        let delayMsec = 1000;

        while (true) {
            await sleepMsec(delayMsec);
            if (this._halt) return;
            if (this._checkConnected()) {
                // we are connected
                const transformedChannelNames = [];
                for (let channelName of this._node.joinedChannelNames()) {
                    transformedChannelNames.push(this._node._gettransformedChannelNameForDiscovery({channelName, nodeId: this._peerId}));
                }
                for (let transformedChannelName of transformedChannelNames) {
                    const message = {
                        type: 'findChannelPeers',
                        transformedChannelName,
                        nodeData: this._node._createNodeData()
                    };
                    this._remoteNodeManager.sendMessageDirectlyToPeer(this._peerId, message);
                }
                delayMsec *= 2;
                if (delayMsec > 10000)
                    delayMsec = 10000;
            }
            else {
                delayMsec = 1000; // check regularly whether we have connected
            }
        }
    }

    async _start() {
        this._startTryingToConnect();
        this._startFindingChannelPeers();
    }
}

export default BootstrapPeerManager;