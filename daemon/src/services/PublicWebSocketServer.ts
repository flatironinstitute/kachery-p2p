import { action } from '../common/action';
import { sleepMsec } from '../common/util';
import { WebSocketInterface, WebSocketServerInterface } from '../external/ExternalInterface';
import { Port, scaledDurationMsec } from '../interfaces/core';
import KacheryP2PNode from '../KacheryP2PNode';
import { ProxyWebsocketConnection } from '../proxyConnections/ProxyWebsocketConnection';

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
        let usedDisconnectDefect = false
        this.#webSocketServer = await this.#node.externalInterface().startWebSocketServer(port, this.#node.nodeId())
        this.#webSocketServer.onConnection((ws: WebSocketInterface) => {
            /////////////////////////////////////////////////////////////////////////
            action('newProxyConnectionToClient', {context: 'PublicWebSocketServer'}, async () => {
                const X = new ProxyWebsocketConnection(this.#node, 'connectionToClient');
                await X.initializeConnectionToClient(ws);
                this.#node.setProxyConnectionToClient(X.remoteNodeId(), X);

                // TEST DEFECT ////////////////////////////////////////////////
                if ((this.#node.getDefects().disconnectIncomingProxyConnectionOnce) && (!usedDisconnectDefect)) {
                    usedDisconnectDefect = true;
                    (async () => {
                        await sleepMsec(scaledDurationMsec(4000))
                        X.close()
                    })()
                }
                ///////////////////////////////////////////////////////////////
            }, null);
            /////////////////////////////////////////////////////////////////////////
        })
    }
}

export default PublicWebSocketServer;