import GarbageMap from '../common/GarbageMap';
import { randomAlphaString } from '../common/util';
import { Address, isBoolean, isProtocolVersion, isString, ProtocolVersion, toNumber, _validateObject } from '../interfaces/core';
import { DgramSocket } from '../KacheryP2PNode';
import { protocolVersion } from '../protocolVersion';
import UdpCongestionManager, { byteCount, durationMsec, DurationMsec, durationMsecToNumber, UdpTimeoutError } from './UdpCongestionManager';

export const UDP_PACKET_HEADER_SIZE = 200

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

export interface UdpPacketSenderHeader {
    protocolVersion: ProtocolVersion,
    packetId: PacketId,
    isConfirmation: boolean
}
export const isUdpPacketSenderHeader = (x: any): x is UdpPacketSenderHeader => {
    return _validateObject(x, {
        protocolVersion: isProtocolVersion,
        packetId: isPacketId,
        isConfirmation: isBoolean
    }, (a) => {
        console.warn(a)
    })
}

export default class UdpPacketSender {
    #socket: DgramSocket
    #congestionManagers = new GarbageMap<Address, UdpCongestionManager>(durationMsec(5 * 60 * 1000))
    #unconfirmedOutgoingPackets = new GarbageMap<PacketId, OutgoingPacket>(durationMsec(5 * 60 * 1000))
    #debugId = randomAlphaString(4)
    constructor(socket: DgramSocket) {
        this.#socket = socket
    }
    socket() {
        return this.#socket
    }
    async sendPackets(address: Address, packets: Buffer[], opts: {timeoutMsec: DurationMsec}): Promise<void> {
        const outgoingPackets = packets.map(p => {
            const pkt = new OutgoingPacket(this, address, p, opts.timeoutMsec)
            this.#unconfirmedOutgoingPackets.set(pkt.packetId(), pkt)
            return pkt
        })
        try {
            await Promise.all(
                outgoingPackets.map(pkt => (pkt.send()))
            )
        }
        catch(err) {
            outgoingPackets.forEach(pkt => {pkt.cancel()})
            throw(err)
        }
    }
    confirmPacket(packetId: PacketId) {
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
        const c = this.#congestionManagers.get(address) || new UdpCongestionManager()
        // do it this way so that garbage collection of GarbageMap will function
        this.#congestionManagers.set(address, c)
        return c
    }
}

class OutgoingPacket {
    #manager: UdpPacketSender
    #packetId: PacketId
    #address: Address
    #buffer: Buffer
    #onConfirmed: (() => void) | null
    #onCancelled: (() => void) | null
    #confirmed = false
    #cancelled = false
    #timeoutMsec: DurationMsec
    constructor(manager: UdpPacketSender, address: Address, buffer: Buffer, timeoutMsec: DurationMsec) {
        this.#manager = manager
        this.#address = address
        this.#buffer = buffer
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
        const cm = this.#manager.congestionManagers(this.#address)
        await cm.sendPacket(this.#packetId, byteCount(this.#buffer.length), async (timeoutMsec) => {
            await this._trySend(timeoutMsec)
        })
    }
    async _trySend(timeoutMsec: DurationMsec) {
        const socket = this.#manager.socket()
        const b = this.#buffer
        return new Promise((resolve, reject) => {
            if (this.#confirmed) {
                resolve()
                return
            }
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
                isConfirmation: false
            }
            const b2 = Buffer.concat([
                Buffer.from(JSON.stringify(h).padEnd(UDP_PACKET_HEADER_SIZE)),
                b
            ])
            socket.send(b2, 0, b2.length, toNumber(this.#address.port), this.#address.hostName.toString(), (err, numBytesSent) => {
                if (err) {
                    if (completed) return;
                    completed = true;
                    reject(Error(`Failed to send udp message to remote: ${err.message}`))
                }
                if (numBytesSent !== b.length) {
                    if (completed) return;
                    completed = true;
                    reject(Error(`Failed to send udp message to remote: unexpected numBytesSent`))
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