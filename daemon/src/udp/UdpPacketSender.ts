import dgram from 'dgram';
import GarbageMap from '../common/GarbageMap';
import { randomAlphaString } from '../common/util';
import { Address, isBoolean, isProtocolVersion, isString, ProtocolVersion, toNumber, _validateObject } from '../interfaces/core';
import { protocolVersion } from '../protocolVersion';
import UdpCongestionManager, { byteCount } from './UdpCongestionManager';

class UdpTimeoutError extends Error {
    constructor(errorString: string) {
      super(errorString);
    }
}

export const UDP_PACKET_HEADER_SIZE = 200

export interface PacketId extends String {
    __packetId__: never // phantom type
}
const examplePacketId: PacketId = "packetId" as any as PacketId
export const isPacketId = (x: any): x is PacketId => {
    if (!isString(x)) return false;
    return (/^[A-Fa-f]{10}?$/.test(x));
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
    })
}

export default class UdpPacketSender {
    #socket: dgram.Socket
    #congestionManagers = new GarbageMap<Address, UdpCongestionManager>(5 * 60 * 1000)
    #unconfirmedOutgoingPackets = new Map<PacketId, OutgoingPacket>()
    constructor(socket: dgram.Socket) {
        this.#socket = socket
    }
    socket() {
        return this.#socket
    }
    async sendPackets(address: Address, packets: Buffer[], opts: {timeoutMsec: number}): Promise<void> {
        const outgoingPackets = packets.map(p => (
            new OutgoingPacket(this, address, p, opts.timeoutMsec)
        ))
        try {
            await Promise.all(
                outgoingPackets.map(p => p.send())
            )
        }
        catch(err) {
            outgoingPackets.forEach(p => {p.cancel()})
            throw(err)
        }
    }
    confirmPacket(packetId: PacketId) {
        const p = this.#unconfirmedOutgoingPackets.get(packetId)
        if (p) {
            p.confirm()
            this.#unconfirmedOutgoingPackets.delete(packetId)
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
    #timeoutMsec: number
    constructor(manager: UdpPacketSender, address: Address, buffer: Buffer, timeoutMsec: number) {
        this.#manager = manager
        this.#address = address
        this.#buffer = buffer
        this.#timeoutMsec = timeoutMsec
        this.#packetId = createPacketId()
    }
    confirm() {
        this.#onConfirmed && this.#onConfirmed()
    }
    async send() {
        this.#manager.congestionManagers(this.#address).queuePacket(byteCount(this.#buffer.length), (onConfirmed: () => void, onTimedOut: () => void, onError: () => void, opts: {timeoutMsec: number}) => {
            (async () => {
                try {
                    await this._trySend(opts.timeoutMsec)
                }
                catch(err) {
                    if (err instanceof UdpTimeoutError) {
                        onTimedOut()
                    }
                    else {
                        onError()
                    }
                    return
                }
                onConfirmed();
            })()
        })
    }
    async _trySend(timeoutMsec: number) {
        const socket = this.#manager.socket()
        const b = this.#buffer
        return new Promise((resolve, reject) => {
            let completed = false
            if (this.#confirmed) {
                resolve()
                return
            }
            if (this.#cancelled) {
                reject(Error('Cancelled'))
                return
            }
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
            socket.send(b2, toNumber(this.#address.port), this.#address.hostName.toString(), (err, numBytesSent) => {
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
                setTimeout(() => {
                    if (!completed) {
                        completed = true;
                        reject(new UdpTimeoutError('Timed out'))
                    }
                }, timeoutMsec)
            })
        })
    }
    cancel() {
        this.#onCancelled && this.#onCancelled()
    }
}