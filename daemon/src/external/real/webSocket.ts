import WebSocket from 'ws';
import { DurationMsec, durationMsecToNumber, isBuffer, NodeId, Port } from '../../interfaces/core';
import { WebSocketInterface, WebSocketServerInterface } from '../ExternalInterface';

const webSocketInterfaceFromWebSocket = (ws: WebSocket): WebSocketInterface => {
    const onMessage = (cb: (buf: Buffer) => void) => {
        ws.on('message', (buf) => {
            /* istanbul ignore next */
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
    return {
        onConnection,
        close: () => { S.close() }
    }
}

export const startWebSocketServer = async (port: Port, nodeId: NodeId): Promise<WebSocketServerInterface> => {
    const S = new WebSocket.Server({ port: port as any as number })
    const wsi = webSocketServerInterfaceFromWebSocketServer(S)
    return new Promise((resolve, reject) => {
        S.on('listening', () => {
            resolve(wsi)
        })
        S.on('error', err => {
            /* istanbul ignore next */
            reject(err)
        })
    })
}

export const createWebSocket = (url: string, opts: { timeoutMsec: DurationMsec }): WebSocketInterface => {
    const ws = new WebSocket(url, { timeout: durationMsecToNumber(opts.timeoutMsec) })
    return webSocketInterfaceFromWebSocket(ws)
}