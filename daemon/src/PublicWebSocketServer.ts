import { ProxyConnectionToClient } from './ProxyConnectionToClient.js';
import { NodeId, Port, toNumber } from './interfaces/core.js';
import KacheryP2PNode from './KacheryP2PNode.js';
import WebSocket from 'ws';
import RemoteNodeManager from './RemoteNodeManager.js';
import { action } from './action.js';

class PublicWebSocketServer {
    #node: KacheryP2PNode
    #webSocketServer: WebSocket.Server
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
                action('newProxyConnectionToClient', {context: 'PublicWebSocketServer'}, async () => {
                    const X = new ProxyConnectionToClient(this.#node);
                    await X.initialize(ws);
                    this.#node.setProxyConnectionToClient(X.remoteNodeId(), X);
                }, null);
            });
        });
    }
}

export default PublicWebSocketServer;