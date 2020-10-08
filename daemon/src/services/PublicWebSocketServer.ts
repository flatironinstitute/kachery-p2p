import WebSocket from 'ws';
import { action } from '../common/action';
import { Port, toNumber } from '../interfaces/core';
import KacheryP2PNode from '../KacheryP2PNode';
import { ProxyConnectionToClient } from '../proxyConnections/ProxyConnectionToClient';

class PublicWebSocketServer {
    #node: KacheryP2PNode
    #webSocketServer: WebSocket.Server | null = null
    constructor(kNode: KacheryP2PNode, {verbose}: {verbose: number}) {
        this.#node = kNode
    }
    stop() {
        if (this.#webSocketServer) {
            this.#webSocketServer.close()
        }
    }
    async startListening(port: Port) {
        return new Promise((resolve, reject) => {
            this.#webSocketServer = new WebSocket.Server({ port: toNumber(port) });
            this.#webSocketServer.on('listening', () => {
                resolve();
            });
            this.#webSocketServer.on('connection', (ws: WebSocket) => {
                /////////////////////////////////////////////////////////////////////////
                action('newProxyConnectionToClient', {context: 'PublicWebSocketServer'}, async () => {
                    const X = new ProxyConnectionToClient(this.#node);
                    await X.initialize(ws);
                    this.#node.setProxyConnectionToClient(X.remoteNodeId(), X);
                }, null);
                /////////////////////////////////////////////////////////////////////////
            });
        });
    }
}

export default PublicWebSocketServer;