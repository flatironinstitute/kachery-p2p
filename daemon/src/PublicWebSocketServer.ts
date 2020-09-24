import { ProxyConnectionToClient } from './ProxyConnectionToClient.js';
import { NodeId, Port, toNumber } from './interfaces/core.js';
import KacheryP2PNode from './KacheryP2PNode.js';
import WebSocket from 'ws';

class PublicWebSocketServer {
    #node: KacheryP2PNode
    #webSocketServer: WebSocket.Server
    #onIncomingProxyConnectionCallbacks: ((nodeId: NodeId, c: ProxyConnectionToClient) => void)[] = []
    constructor(kNode: KacheryP2PNode, {verbose: number}) {
        this.#node = kNode
    }
    async startListening(port: Port) {
        return new Promise((resolve, reject) => {
            this.#webSocketServer = new WebSocket.Server({ port: toNumber(port) });
            this.#webSocketServer.on('listening', () => {
                resolve();
            });
            this.#webSocketServer.on('connection', (ws: WebSocket) => {
                (async () => {
                    const X = new ProxyConnectionToClient(this.#node);
                    await X.initialize(ws);
                    this.#onIncomingProxyConnectionCallbacks.forEach(cb => {cb(X.remoteNodeId(), X)})
                })();
            });
        });
    }
    onIncomingProxyConnection(callback: (nodeId: NodeId, c: ProxyConnectionToClient) => void) {
        this.#onIncomingProxyConnectionCallbacks.push(callback);
    }
}

export default PublicWebSocketServer;