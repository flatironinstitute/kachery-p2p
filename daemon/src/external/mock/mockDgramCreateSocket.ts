import { randomAlphaString } from "../../common/util"
import { HostName, NodeId, Port } from "../../interfaces/core"
import { DgramCreateSocketFunction, DgramRemoteInfo } from "../ExternalInterface"

type DgramSocketType = 'udp4' | 'udp6'

interface BoundSocket {
    id: string
    socket: MockDgramSocket
    port: Port
}

class MockDgramSocketManager {
    #boundSockets: BoundSocket[] = []
    constructor() {
    }
    bind(id: string, port: Port, socket: MockDgramSocket) {
        this.#boundSockets.push({
            id,
            socket,
            port
        })
    }
    unbind(id: string) {
        this.#boundSockets = this.#boundSockets.filter(x => (x.id !== id))
    }
    socketsBelongingToAddress(address: string, port: Port) {
        return this.#boundSockets.filter(x => {
            return ((x.socket.hasMembership(address))  && (x.port === port))
        }).map(x => (x.socket))
    }
}
const dgramSocketManager = new MockDgramSocketManager()

class MockDgramSocket {
    #id = randomAlphaString(10)
    #type: DgramSocketType
    #reuseAddr: boolean
    #hostName: HostName
    #bound = false
    #port: Port = 0 as any as Port
    #onListeningCallbacks: (() => void)[] = []
    #onMessageCallbacks: ((message: Buffer, rinfo: DgramRemoteInfo) => void)[] = []
    #memberships = new Set<string>()
    constructor(args: {type: DgramSocketType, reuseAddr: boolean, hostName: HostName}) {
        this.#type = args.type
        this.#reuseAddr = args.reuseAddr
        this.#hostName = args.hostName
    }
    bind(port: number) {
        dgramSocketManager.bind(this.#id, port as any as Port, this)
        this.#bound = true
        this.#port = port as any as Port
        this.#onListeningCallbacks.forEach(cb => {cb()})
    }
    hasMembership(a: string) {
        return this.#memberships.has(a)
    }
    close() {
        dgramSocketManager.unbind(this.#id)
    }
    on(eventName: 'listening' | 'message', callback: (() => void) | ((message: Buffer, rinfo: DgramRemoteInfo) => void)) {
        if (eventName === 'listening') {
            this.#onListeningCallbacks.push(callback as (() => void))
            if (this.#bound) {
                this.#onListeningCallbacks.forEach(cb => {cb()})
            }
        }
        else if (eventName === 'message') {
            this.#onMessageCallbacks.push(callback as ((message: Buffer, rinfo: DgramRemoteInfo) => void))
        }
    }
    addMembership(address: string) {
        this.#memberships.add(address)
    }
    send(message: Buffer, offset: number, length: number, port: number, address: string, callback?: (err: Error | null, numBytesSent: number) => void) {
        const sockets = dgramSocketManager.socketsBelongingToAddress(address, port as any as Port)
        sockets.forEach(socket => {
            const rinfo: DgramRemoteInfo = {
                address: this.#hostName.toString(),
                family: 'IPv4',
                port: this.#port as any as number,
                size: 0
            }
            socket._handleMessage(message, rinfo)
        })
        callback && callback(null, message.length)
    }
    _handleMessage(message: Buffer, rinfo: DgramRemoteInfo) {
        this.#onMessageCallbacks.forEach(cb => {
            cb(message, rinfo)
        })
    }
}

const mockDgramCreateSocket: DgramCreateSocketFunction = (args: {type: 'udp4', reuseAddr: boolean, nodeId: NodeId}) => {
    const s = new MockDgramSocket({type: args.type, reuseAddr: args.reuseAddr, hostName: args.nodeId as any as HostName})
    s.addMembership(args.nodeId.toString())
    return s
}

export default mockDgramCreateSocket
