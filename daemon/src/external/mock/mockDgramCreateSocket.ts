import { randomAlphaString } from "../../common/util"
import { hostName, HostName, NodeId, Port, toPort } from "../../interfaces/core"
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
    socketsBelongingToAddress(address: string, port: Port, fromAddress: string) {
        return this.#boundSockets.filter(x => {
            if (x.port !== port) return false
            if (x.socket.hasMembership(address)) {
                return true
            }
            if (x.socket.hasFirewalledAddress(address)) {
                if (x.socket.hasOutgoingAddress(fromAddress)) {
                    return true
                }
                else {
                    return false
                }
            }
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
    #port: Port = toPort(1)
    #onListeningCallbacks: (() => void)[] = []
    #onMessageCallbacks: ((message: Buffer, rinfo: DgramRemoteInfo) => void)[] = []
    #memberships = new Set<string>()
    #firewalledAddresses = new Set<string>()
    #outgoingAddresses = new Set<string>()
    constructor(args: {type: DgramSocketType, reuseAddr: boolean, hostName: HostName}) {
        this.#type = args.type
        this.#reuseAddr = args.reuseAddr
        this.#hostName = args.hostName
    }
    bind(p: number) {
        dgramSocketManager.bind(this.#id, toPort(p), this)
        this.#bound = true
        this.#port = toPort(p)
        this.#onListeningCallbacks.forEach(cb => {cb()})
    }
    hasMembership(a: string) {
        return this.#memberships.has(a)
    }
    hasFirewalledAddress(a: string) {
        return this.#firewalledAddresses.has(a)
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
    addFirewalledAddress(address: string) {
        this.#firewalledAddresses.add(address)
    }
    send(message: Buffer, offset: number, length: number, port: number, address: string, callback?: (err: Error | null, numBytesSent: number) => void) {
        this.#outgoingAddresses.add(address + ':' + port)
        const sockets = dgramSocketManager.socketsBelongingToAddress(address, toPort(port), this.#hostName + ':' + this.#port)
        sockets.forEach(socket => {
            const rinfoAddress = address.startsWith('local-') ? 'local-' + this.#hostName.toString() : this.#hostName.toString()
            const rinfo: DgramRemoteInfo = {
                address: rinfoAddress,
                family: 'IPv4',
                port: this.#port as any as number,
                size: 0
            }
            socket._handleMessage(message, rinfo)
        })
        callback && callback(null, message.length)
    }
    hasOutgoingAddress(x: string) {
        return this.#outgoingAddresses.has(x)
    }
    _handleMessage(message: Buffer, rinfo: DgramRemoteInfo) {
        this.#onMessageCallbacks.forEach(cb => {
            cb(message, rinfo)
        })
    }
}

const mockDgramCreateSocket: DgramCreateSocketFunction = (args: {type: 'udp4', reuseAddr: boolean, nodeId: NodeId, firewalled: boolean}) => {
    const s = new MockDgramSocket({type: args.type, reuseAddr: args.reuseAddr, hostName: hostName(args.nodeId.toString())})
    if (args.firewalled) {
        s.addFirewalledAddress(args.nodeId.toString())
    }
    else {
        s.addMembership(args.nodeId.toString())
    }
    s.addMembership('local-' + args.nodeId.toString())
    return s
}

export default mockDgramCreateSocket
