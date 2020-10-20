import { randomAlphaString, sleepMsec } from "../../common/util"
import { DurationMsec, durationMsec, durationMsecToNumber, elapsedSince, NodeId, nowTimestamp, Port } from "../../interfaces/core"
import { WebSocketInterface, WebSocketServerInterface } from "../ExternalInterface"

interface MockWebSocketUrl extends String {
    __mockWebSocketUrl__: never
}
const mockWebSocketUrl = (x: string) => {
    return x as any as MockWebSocketUrl
}

interface MockWebSocketId extends String {
    __webSocketId__: never
}
const createMockWebSocketId = () => {
    return randomAlphaString(10) as any as MockWebSocketId
}

class MockWebSocketServer {
    #incomingConnections = new Map<MockWebSocketId, MockWebSocket>()
    #onListeningCallbacks: (() => void)[] = []
    #onConnectionCallbacks: ((ws: WebSocketInterface) => void)[] = []
    #listening = false
    constructor(private port: Port, private nodeId: NodeId) {
        mockWebSocketManager.startServer(port, nodeId, this)
        this.#listening = true
    }
    onListening(callback: () => void) {
        if (this.#listening) {
            setTimeout(() => {
                callback()
            }, 1)
        }
        this.#onListeningCallbacks.push(callback as (() => void))
    }
    onConnection(callback: (ws: WebSocketInterface) => void) {
        this.#incomingConnections.forEach(ws => {
            setTimeout(() => {
                callback(ws)
            }, 1)
        })
        this.#onConnectionCallbacks.push(callback as ((ws: WebSocketInterface) => void))
    }
    close() {
        this.#incomingConnections.forEach(ws => {
            ws.close()
        })
        mockWebSocketManager.stopServer(this.port, this.nodeId)
    }
    _addConnection(ws: MockWebSocket) {
        const incomingWs = new MockWebSocket(null, {timeoutMsec: durationMsec(0)})
        incomingWs._setCompanion(ws)
        this.#incomingConnections.set(ws._id(), ws)
        this.#onConnectionCallbacks.forEach(cb => {
            cb(incomingWs)
        })
    }
}

type CB1 = (code: number, reason: string) => void
type CB2 = (err: Error | null) => void
type CB3 = (buf: Buffer) => void

export default class MockWebSocket {
    #id = createMockWebSocketId()
    #onOpenCallbacks: (() => void)[] = []
    #onCloseCallbacks: CB1[] = []
    #onErrorCallbacks: CB2[] = []
    #onMessageCallbacks: CB3[] = []
    #open = false
    #companion: MockWebSocket | null = null
    constructor(url: MockWebSocketUrl | null, opts: {timeoutMsec: DurationMsec}) {
        if (url) {
            this._connectToServer(url, opts)
        }
    }
    onOpen(callback: () => void) {
        if (this.#open) {
            callback()
        }
        this.#onOpenCallbacks.push(callback)
    }
    onClose(callback: CB1) {
        this.#onCloseCallbacks.push(callback)
    }
    onError(callback: CB2) {
        this.#onErrorCallbacks.push(callback)
    }
    onMessage(callback: CB3) {
        this.#onMessageCallbacks.push(callback)
    }
    close() {
        if (this.#open) {
            this.#open = false
            this.#onCloseCallbacks.forEach(cb => {cb(0, '')})
            if (this.#companion) {
                this.#companion.close()
            }
            this.#companion = null
        }
    }
    send(buf: Buffer) {
        if (!this.#open) {
            this._handleError(Error('Cannot send, websocket is closed'))
            return
        }
        if (!this.#companion) {
            this._handleError(Error('Cannot send, no websocket companion'))
            return
        }
        const companion = this.#companion
        setTimeout(() => {
            companion._handleIncomingMessage(buf)
        }, 2)
    }
    _id() {
        return this.#id
    }
    _connectToServer(url: MockWebSocketUrl, opts: {timeoutMsec: DurationMsec}) {
        (async () => {
            const timer = nowTimestamp()
            while (true) {
                const S: MockWebSocketServer | null = mockWebSocketManager.findServer(url)
                if (S) {
                    S._addConnection(this)
                    return
                }
                else {
                    if (elapsedSince(timer) > durationMsecToNumber(opts.timeoutMsec)) {
                        this._handleError(Error(`Unable to find websocket server: ${url}`))
                        return
                    }
                    else {
                        await sleepMsec(1)
                    }
                }
            }
        })()
    }
    _handleError(err: Error) {
        this.#onErrorCallbacks.forEach(cb => {
            cb(err)
        })
        if (this.#open) {
            this.close()
        }
    }
    _handleIncomingMessage(buf: Buffer) {
        this.#onMessageCallbacks.forEach(cb => {
            cb(buf)
        })
    }
    _setCompanion(c: MockWebSocket) {
        if (!this.#open) {
            this.#open = true
            this.#companion = c
            c._setCompanion(this)
            this.#onOpenCallbacks.forEach(cb => {cb()})
        }
    }
}

class MockWebSocketManager {
    #webSockets = new Map<MockWebSocketId, MockWebSocket>()
    #webSocketServers = new Map<MockWebSocketUrl, MockWebSocketServer>()
    constructor() {
    }
    startServer(port: Port, nodeId: NodeId, server: MockWebSocketServer) {
        const url = mockWebSocketUrl(`ws://${nodeId.toString()}:${port as any as number}`)
        this.#webSocketServers.set(url, server)
    }
    stopServer(port: Port, nodeId: NodeId) {
        const url = mockWebSocketUrl(`ws://${nodeId.toString()}:${port as any as number}`)
        this.#webSocketServers.delete(url)
    }
    findServer(url: MockWebSocketUrl) {
        return this.#webSocketServers.get(url) || null
    }
}
const mockWebSocketManager = new MockWebSocketManager()


export const mockStartWebSocketServer = async (port: Port, nodeId: NodeId): Promise<WebSocketServerInterface> => {
    return new MockWebSocketServer(port, nodeId)
}

export const mockCreateWebSocket = (url: string, opts: {timeoutMsec: DurationMsec}): WebSocketInterface => {
    return new MockWebSocket(url as any as MockWebSocketUrl, opts)
}