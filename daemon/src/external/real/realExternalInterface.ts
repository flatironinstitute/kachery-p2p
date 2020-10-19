import dgram from 'dgram';
import fs from 'fs';
import http from 'http';
import https from 'https';
import WebSocket from 'ws';
import { DurationMsec, durationMsecToNumber, isBuffer, NodeId, Port, toNumber } from '../../interfaces/core';
import ExternalInterface, { ExpressInterface, HttpServerInterface, WebSocketInterface, WebSocketServerInterface } from '../ExternalInterface';
import { httpGetDownload, httpPostJson } from "./httpPostJson";
import { KacheryStorageManager } from './kacheryStorage/KacheryStorageManager';


const webSocketInterfaceFromWebSocket = (ws: WebSocket): WebSocketInterface => {
    const onMessage = (cb: (buf: Buffer) => void) => {
        ws.on('message', (buf) => {
            if (!isBuffer(buf)) {
                console.warn('Incoming message is not a Buffer')
                ws.close()
                return
            }
            cb(buf)
        })
    }
    const onError = (cb: (err: Error) => void) => {
        ws.on('error', (err) => {
            cb(err)
        })
    }
    const onClose = (cb: (code: number, reason: string) => void) => {
        ws.on('close', (code, reason) => {
            cb(code, reason)
        })
    }
    const onOpen = (cb: () => void) => {
        ws.on('open', () => {
            cb()
        })
    }
    return {
        onOpen,
        onMessage,
        onError,
        onClose,
        close: () => { ws.close() },
        send: (buf: Buffer) => { ws.send(buf) }
    }
}

const webSocketServerInterfaceFromWebSocketServer = (S: WebSocket.Server): WebSocketServerInterface => {
    const onConnection = (cb: (ws: WebSocketInterface) => void) => {
        S.on('connection', (ws: WebSocket) => {
            cb(webSocketInterfaceFromWebSocket(ws))
        })
    }
    const onListening = (cb: () => void) => {

    }
    return {
        onConnection,
        onListening,
        close: () => { S.close() }
    }
}

const startHttpServer = (app: ExpressInterface, listenPort: Port): HttpServerInterface => {
    // convenient for starting either as http or https depending on the port
    let protocol: 'http' | 'https'
    let server: HttpServerInterface
    if (process.env.SSL != null ? process.env.SSL : toNumber(listenPort) % 1000 == 443) {
        // The port number ends with 443, so we are using https
        // app.USING_HTTPS = true;
        protocol = 'https';
        // Look for the credentials inside the encryption directory
        // You can generate these for free using the tools of letsencrypt.org
        const options = {
            key: fs.readFileSync(__dirname + '/encryption/privkey.pem'),
            cert: fs.readFileSync(__dirname + '/encryption/fullchain.pem'),
            ca: fs.readFileSync(__dirname + '/encryption/chain.pem')
        };

        // Create the https server
        server = https.createServer(options, app as http.RequestListener);
    } else {
        protocol = 'http';
        // Create the http server and start listening
        server = http.createServer(app as http.RequestListener);
    }
    server.listen(toNumber(listenPort));
    console.info('API server is running', {protocol, port: listenPort}, {print: true});
    return server
}


const realExternalInterface = (): ExternalInterface => {
    const dgramCreateSocket = (args: { type: 'udp4', reuseAddr: boolean }) => {
        return dgram.createSocket({ type: args.type, reuseAddr: args.reuseAddr })
    }

    const createWebSocketServer = (port: Port, nodeId: NodeId): WebSocketServerInterface => {
        const S = new WebSocket.Server({ port: port as any as number })
        return webSocketServerInterfaceFromWebSocketServer(S)
    }

    const createWebSocket = (url: string, opts: { timeoutMsec: DurationMsec }): WebSocketInterface => {
        const ws = new WebSocket(url, { timeout: durationMsecToNumber(opts.timeoutMsec) })
        return webSocketInterfaceFromWebSocket(ws)
    }

    const createKacheryStorageManager = () => {
        return new KacheryStorageManager()
    }

    return {
        httpPostJson: httpPostJson,
        httpGetDownload: httpGetDownload,
        dgramCreateSocket: dgramCreateSocket,
        createWebSocketServer: createWebSocketServer,
        createWebSocket: createWebSocket,
        createKacheryStorageManager: createKacheryStorageManager,
        startHttpServer: startHttpServer
    }
}

export default realExternalInterface