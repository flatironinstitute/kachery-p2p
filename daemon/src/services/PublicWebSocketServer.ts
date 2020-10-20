import { action } from '../common/action';
import { WebSocketInterface, WebSocketServerInterface } from '../external/ExternalInterface';
import { Port } from '../interfaces/core';
import KacheryP2PNode from '../KacheryP2PNode';
import { ProxyConnectionToClient } from '../proxyConnections/ProxyConnectionToClient';

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
        this.#webSocketServer = await this.#node.startWebSocketServer(port)
        this.#webSocketServer.onConnection((ws: WebSocketInterface) => {
            /////////////////////////////////////////////////////////////////////////
            action('newProxyConnectionToClient', {context: 'PublicWebSocketServer'}, async () => {
                const X = new ProxyConnectionToClient(this.#node);
                await X.initialize(ws);
                this.#node.setProxyConnectionToClient(X.remoteNodeId(), X);
            }, null);
            /////////////////////////////////////////////////////////////////////////
        })
    }
}

export default PublicWebSocketServer;