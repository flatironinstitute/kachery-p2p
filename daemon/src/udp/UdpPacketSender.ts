import GarbageMap from '../common/GarbageMap';
import { randomAlphaString } from '../common/util';
import { DgramSocket } from '../external/ExternalInterface';
import { Address, byteCount, ChannelName, DurationMsec, durationMsecToNumber, isBoolean, isEqualTo, isNodeId, isString, JSONObject, NodeId, portToNumber, ProtocolVersion, scaledDurationMsec, sha1OfObject, _validateObject } from '../interfaces/core';
import NodeStats from '../NodeStats';
import { protocolVersion } from '../protocolVersion';
import UdpCongestionManager, { UdpTimeoutError } from './UdpCongestionManager';

export interface PacketId extends String {
    __packetId__: never // phantom type
}
const examplePacketId: PacketId = "packetId" as any as PacketId
export const isPacketId = (x: any): x is PacketId => {
    if (!isString(x)) return false;
    return (/^[A-Za-z]{10}$/.test(x));
}
export const createPacketId = () => {
    return randomAlphaString(10) as any as PacketId;
}

export interface FallbackAddress extends JSONObject {
    __packetId__: never // phantom type
}

export const UDP_PACKET_HEADER_SIZE = 500
export interface UdpPacketSenderHeader {
    protocolVersion: ProtocolVersion, // 10
    fromNodeId: NodeId, // 64
    toNodeId: NodeId, // 64
    packetId: PacketId, // 10
    isConfirmation: boolean // 10
}
export const isUdpPacketSenderHeader = (x: any): x is UdpPacketSenderHeader => {
    return _validateObject(x, {
        protocolVersion: isEqualTo(protocolVersion()),
        fromNodeId: isNodeId,
        toNodeId: isNodeId,
        packetId: isPacketId,
        isConfirmation: isBoolean
    })
}

interface FallbackPacketSenderInterface {
    sendPacket: (fallbackAddress: FallbackAddress, packetId: PacketId, packet: Buffer, channelName: ChannelName) => Promise<void>
}

export default class UdpPacketSender {
    #socket: DgramSocket
    #congestionManagers = new GarbageMap<string, UdpCongestionManager>(scaledDurationMsec(5 * 60 * 1000))
    #unconfirmedOutgoingPackets = new GarbageMap<PacketId, OutgoingPacket>(scaledDurationMsec(5 * 60 * 1000))
    #debugId = randomAlphaString(4)
    constructor(socket: DgramSocket, private fallbackPacketSender: FallbackPacketSenderInterface, private stats: NodeStats, private opts: {thisNodeId: NodeId}) {
        this.#socket = socket
    }
    socket() {
        return this.#socket
    }
    async sendPackets(address: Address | null, fallbackAddress: FallbackAddress, packets: Buffer[], channelName: ChannelName, opts: {timeoutMsec: DurationMsec, toNodeId: NodeId}): Promise<void> {
        const outgoingPackets = packets.map(p => {
            const pkt = new OutgoingPacket(this, address, fallbackAddress, p, channelName, opts.timeoutMsec, this.stats, {thisNodeId: this.opts.thisNodeId, toNodeId: opts.toNodeId})
            this.#unconfirmedOutgoingPackets.set(pkt.packetId(), pkt)
            return pkt
        })
        const promises: Promise<void>[] = outgoingPackets.map(pkt => {
            this.stats.reportBytesSent('udp', opts.toNodeId, pkt.size())
            return pkt.send()
        }) // send the packets and await all the promises
        try {
            for (let p of promises) {
                await p
            }
        }
        catch(err) {
            outgoingPackets.forEach(pkt => {pkt.cancel()})
            throw(err)
        }
    }
    receivePacketConfirmation(packetId: PacketId) {
        const p = this.#unconfirmedOutgoingPackets.get(packetId)
        if (p) {
            p.confirm()
            this.#unconfirmedOutgoingPackets.delete(packetId)
        }
        else {
            console.warn(`Unable to confirm packet with ID: ${packetId}`, this.#debugId)
        }
    }
    congestionManagers(address: Address) {
        const addressHash = sha1OfObject(address as any as JSONObject).toString()
        const c = this.#congestionManagers.get(addressHash) || new UdpCongestionManager()
        // do it this way so that garbage collection of GarbageMap will function
        this.#congestionManagers.set(addressHash, c)
        return c
    }
    async _fallbackSendPacket(fallbackAddress: FallbackAddress, packetId: PacketId, buffer: Buffer, channelName: ChannelName): Promise<void> {
        await this.fallbackPacketSender.sendPacket(fallbackAddress, packetId, buffer, channelName)
    }
}

class OutgoingPacket {
    #packetSender: UdpPacketSender
    #packetId: PacketId
    #address: Address | null
    #fallbackAddress: FallbackAddress
    #buffer: Buffer
    #channelName: ChannelName
    #onConfirmed: (() => void) | null
    #onCancelled: (() => void) | null
    #confirmed = false
    #cancelled = false
    #timeoutMsec: DurationMsec
    constructor(packetSender: UdpPacketSender, address: Address | null, fallbackAddress: FallbackAddress, buffer: Buffer, channelName: ChannelName, timeoutMsec: DurationMsec, private stats: NodeStats, private opts: {thisNodeId: NodeId, toNodeId: NodeId}) {
        this.#packetSender = packetSender
        this.#address = address
        this.#fallbackAddress = fallbackAddress
        this.#buffer = buffer
        this.#channelName = channelName
        this.#timeoutMsec = timeoutMsec
        this.#packetId = createPacketId()
    }
    packetId() {
        return this.#packetId
    }
    confirm() {
        this.#onConfirmed && this.#onConfirmed()
    }
    async send() {
        if (this.#address === null) {
            await this.#packetSender._fallbackSendPacket(this.#fallbackAddress, this.#packetId, this.#buffer, this.#channelName)
            return
        }
        const cm = this.#packetSender.congestionManagers(this.#address)
        try {
            await cm.sendPacket(this.#packetId, byteCount(this.#buffer.length), async (timeoutMsec) => {
                await this._trySend(timeoutMsec)
            })
        }
        catch(err) {
            await this.#packetSender._fallbackSendPacket(this.#fallbackAddress, this.#packetId, this.#buffer, this.#channelName)
        }
    }
    size() {
        return byteCount(this.#buffer.length)
    }
    async _trySend(timeoutMsec: DurationMsec) {
        const socket = this.#packetSender.socket()
        const b = this.#buffer
        return new Promise((resolve, reject) => {
            /* istanbul ignore next */
            if (this.#confirmed) {
                resolve()
                return
            }
            /* istanbul ignore next */
            if (this.#cancelled) {
                reject(Error('Cancelled'))
                return
            }
            let completed = false
            this.#onConfirmed = () => {
                if (completed) return;
                completed = true;
                resolve()
            }
            this.#onCancelled = () => {
                if (completed) return;
                completed = true;
                reject(Error('Canceled'))
            }
            const h: UdpPacketSenderHeader = {
                protocolVersion: protocolVersion(),
                packetId: this.#packetId,
                fromNodeId: this.opts.thisNodeId,
                toNodeId: this.opts.toNodeId,
                isConfirmation: false
            }
            const b2 = Buffer.concat([
                Buffer.from(JSON.stringify(h).padEnd(UDP_PACKET_HEADER_SIZE)),
                b
            ])
            /* istanbul ignore next */
            if (!this.#address) throw Error('Unexpected address in _trySend')
            this.stats.reportBytesSent('udp', this.opts.toNodeId, byteCount(b2.length))
            socket.send(b2, 0, b2.length, portToNumber(this.#address.port), this.#address.hostName.toString(), (err, numBytesSent) => {
                /* istanbul ignore next */
                if (err) {
                    if (completed) return
                    completed = true
                    reject(Error(`Failed to send udp message to remote: ${err.message}`))
                }
                /* istanbul ignore next */
                if (numBytesSent !== b2.length) {
                    if (completed) return
                    completed = true
                    console.warn(this.#address)
                    reject(Error(`Failed to send udp message to remote: unexpected numBytesSent: ${numBytesSent} <> ${b.length}`))
                }
            })
            setTimeout(() => {
                if (!completed) {
                    completed = true;
                    reject(new UdpTimeoutError('Timed out'))
                }
            }, durationMsecToNumber(timeoutMsec))
        })
    }
    cancel() {
        this.#onCancelled && this.#onCancelled()
    }
}