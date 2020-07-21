import WebSocket from 'ws';
import { JSONStringifyDeterministic } from './common/crypto_util.js'

class WebsocketServer {
    constructor() {
        this._onConnectionCallbacks = [];
    }
    onConnection = (cb) => {
        this._onConnectionCallbacks.push(cb);
    }
    async listen(port) {
        ///////////////////////////////////////////////////////////////////////////////
        const websocketServer = new WebSocket.Server({ port });
        websocketServer.on('connection', (ws) => {
            let X = new IncomingWebSocketConnection(ws);
            let initialized = false;
            X.onMessage(msg => {
                if (initialized) return;
                if (msg.type === 'initial') {
                    // todo: verify the protocol version here?
                    const initialInfo = msg.initialInfo;
                    initialized = true;
                    this._onConnectionCallbacks.forEach(cb => {
                        cb(X, initialInfo);
                    });
                }
                else {
                    X.disconnect();
                }
            });
        });
        ///////////////////////////////////////////////////////////////////////////////
    }
}

class IncomingWebSocketConnection {
    constructor(webSocket) {
        this._webSocket = webSocket;
        this._onMessageCallbacks = [];
        this._onDisconnectCallbacks = [];

        this._webSocket.on('close', () => {
            this._onDisconnectCallbacks.forEach(cb => cb());
        })

        this._webSocket.on('error', () => {
            // this is important so we don't throw an exception
            // question: do we need to do something here? will 'close' be called also?
        });

        this._webSocket.on('message', (message) => {
            const msg = JSON.parse(message);
            this._onMessageCallbacks.forEach(cb => {
                cb(msg);
            })
        });
    }
    onMessage(cb) {
        this._onMessageCallbacks.push(cb);
    }
    onDisconnect(cb) {
        this._onDisconnectCallbacks.push(cb);
    }
    sendMessage(msg) {
        this._webSocket.send(JSONStringifyDeterministic(msg));
    }
    disconnect() {
        this._webSocket.close();
    }
}

export default WebsocketServer;