import dgram from 'dgram'
import WebSocket from 'ws'
import { DurationMsec, durationMsecToNumber, isBuffer, NodeId, Port } from '../../interfaces/core'
import { KacheryStorageManager } from "../../kacheryStorage/KacheryStorageManager"
import ExternalInterface, { WebSocketInterface, WebSocketServerInterface } from '../ExternalInterface'
import { httpGetDownload, httpPostJson } from "./httpPostJson"

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

    const kacheryStorageManager = new KacheryStorageManager()

    return {
        httpPostJsonFunction: httpPostJson,
        httpGetDownloadFunction: httpGetDownload,
        dgramCreateSocketFunction: dgramCreateSocket,
        createWebSocketServerFunction: createWebSocketServer,
        createWebSocketFunction: createWebSocket,
        kacheryStorageManager: new KacheryStorageManager()
    }
}

export default realExternalInterface