import dgram from 'dgram';
import { DgramSocket } from '../external/ExternalInterface';
import { MockNodeDefects } from '../external/mock/MockNodeDaemon';
import { byteCount, NodeId, tryParseJsonObject } from '../interfaces/core';
import NodeStats from '../NodeStats';
import { protocolVersion } from '../protocolVersion';
import { isUdpPacketSenderHeader, PacketId, UdpPacketSenderHeader, UDP_PACKET_HEADER_SIZE } from './UdpPacketSender';

export default class UdpPacketReceiver {
    #socket: DgramSocket
    #onPacketCallbacks: ((packetId: PacketId, buffer: Buffer, remoteInfo: dgram.RemoteInfo) => void)[] = []
    #onConfirmationCallbacks: ((packetId: PacketId) => void)[] = []
    #numPacketsReceived: number = 0
    constructor(socket: DgramSocket, private getDefects: () => MockNodeDefects, stats: NodeStats, opts: {thisNodeId: NodeId}) {
        this.#socket = socket

        this.#socket.on('message', (message: Buffer, remoteInfo) => {
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
            if ((header.protocolVersion + '') !== protocolVersion() + '') {
                // just ignore if incorrect protocol version
                return
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
                fromNodeId: opts.thisNodeId,
                toNodeId: header.fromNodeId,
                isConfirmation: true
            }
            const buf = Buffer.from(JSON.stringify(h).padEnd(UDP_PACKET_HEADER_SIZE))
            stats.reportBytesSent('udp', header.fromNodeId, byteCount(buf.length))
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
    numPacketsReceived() {
        return this.#numPacketsReceived
    }
}