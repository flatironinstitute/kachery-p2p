import { action } from '../common/action';
import { Port } from '../interfaces/core';
import KacheryP2PNode from '../KacheryP2PNode';
import { ProxyConnectionToClient } from '../proxyConnections/ProxyConnectionToClient';

export interface WebSocketInterface {
    onOpen: (callback: () => void) => void
    onClose: (callback: (code: number, reason: string) => void) => void
    onError: (callback: (err: Error | null) => void) => void
    onMessage: (callback: (buf: Buffer) => void) => void
    close: () => void
    send: (buf: Buffer) => void
}

export interface WebSocketServerInterface {
    onListening: (callback: () => void) => void
    onConnection: (callback: (ws: WebSocketInterface) => void) => void
    close: () => void
}

class PublicWebSocketServer {
    #node: KacheryP2PNode
    #webSocketServer: WebSocketServerInterface | null = null
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
            this.#webSocketServer = this.#node.createWebSocketServer(port)
            this.#webSocketServer.onListening(() => {
                resolve();
            });
            this.#webSocketServer.onConnection((ws: WebSocketInterface) => {
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