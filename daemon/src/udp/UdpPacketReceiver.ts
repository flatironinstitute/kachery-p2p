import dgram from 'dgram';
import { DgramSocket } from '../external/ExternalInterface';
import { MockNodeDefects } from '../external/mock/MockNodeDaemon';
import { addByteCount, byteCount, ByteCount, tryParseJsonObject } from '../interfaces/core';
import { protocolVersion } from '../protocolVersion';
import { isUdpPacketSenderHeader, PacketId, UdpPacketSenderHeader, UDP_PACKET_HEADER_SIZE } from './UdpPacketSender';

export default class UdpPacketReceiver {
    #socket: DgramSocket
    #onPacketCallbacks: ((packetId: PacketId, buffer: Buffer, remoteInfo: dgram.RemoteInfo) => void)[] = []
    #onConfirmationCallbacks: ((packetId: PacketId) => void)[] = []
    #numPacketsReceived: number = 0
    #numBytesReceived: ByteCount = byteCount(0)
    constructor(socket: DgramSocket, private getDefects: () => MockNodeDefects) {
        this.#socket = socket

        this.#socket.on('message', (message: Buffer, remoteInfo) => {
            this.#numBytesReceived = addByteCount(this.#numBytesReceived, byteCount(message.length))
            this.#numPacketsReceived ++
            const udpPacketLossNum = this.getDefects().udpPacketLossNum || null
            if (udpPacketLossNum !== null) {
                if (((this.#numPacketsReceived - 1) % udpPacketLossNum) === (udpPacketLossNum - 1)) {
                    // lose this message
                    return
                }
            }
            const headerTxt = message.slice(0, UDP_PACKET_HEADER_SIZE).toString().trimEnd()
            const dataBuffer = message.slice(UDP_PACKET_HEADER_SIZE);
            const header = tryParseJsonObject(headerTxt)
            if (header === null) {
                return;
            }
            if (!isUdpPacketSenderHeader(header)) {
                console.warn('Unexpected udp packet header')
                return;
            }
            if (header.isConfirmation) {
                this.#onConfirmationCallbacks.forEach(cb => {cb(header.packetId)})
                return
            }
            // send confirmation
            const h: UdpPacketSenderHeader = {
                protocolVersion: protocolVersion(),
                packetId: header.packetId,
                isConfirmation: true
            }
            const buf = Buffer.from(JSON.stringify(h).padEnd(UDP_PACKET_HEADER_SIZE))
            this.#socket.send(buf, 0, buf.length, remoteInfo.port, remoteInfo.address)

            this.#onPacketCallbacks.forEach(cb => {
                cb(header.packetId, dataBuffer, remoteInfo)
            })
        })
    }
    onPacket(callback: (packetId: PacketId, buffer: Buffer, remoteInfo: dgram.RemoteInfo) => void) {
        this.#onPacketCallbacks.push(callback)
    }
    onConfirmation(callback: (packetId: PacketId) => void) {
        this.#onConfirmationCallbacks.push(callback)
    }
    socket() {
        return this.#socket
    }
    numBytesReceived() {
        return this.#numBytesReceived
    }
    numPacketsReceived() {
        return this.#numPacketsReceived
    }
}