import GarbageMap from '../common/GarbageMap'
import { Address } from '../interfaces/core'
import { MessagePartData, numPartsToNumber, partIndex, UdpHeader, UdpMessagePartId } from '../interfaces/UdpMessage'
import { durationMsec } from './UdpCongestionManager'

export default class UdpMessagePartManager {
    #messageParts = new GarbageMap<UdpMessagePartId, MessagePartData>(durationMsec(30 * 60 * 1000))
    #onMessageCompleteCallbacks: ((remoteAddress: Address, header: UdpHeader, data: Buffer) => void)[] = []
    constructor() {}
    addMessagePart(remoteAddress: Address, udpMessagePartId: UdpMessagePartId, header: UdpHeader, buffer: Buffer) {
        this.#messageParts.set(udpMessagePartId, {header, buffer})
        let complete = true
        const numParts = numPartsToNumber(udpMessagePartId.numParts)
        const buffers: Buffer[] = []
        const headers: UdpHeader[] = [] 
        for (let i = 0; i < numParts; i++) {
            const id = {
                udpMessageId: udpMessagePartId.udpMessageId,
                partIndex: partIndex(i),
                numParts: udpMessagePartId.numParts
            }
            const d = this.#messageParts.get(id)
            if (d) {
                buffers.push(d.buffer)
                headers.push(d.header)
            }
            else {
                complete = false;
                break;
            }
        }
        if (complete) {
            for (let i = 0; i < numParts; i++) {
                const id = {
                    udpMessageId: udpMessagePartId.udpMessageId,
                    partIndex: partIndex(i),
                    numParts: udpMessagePartId.numParts
                }
                this.#messageParts.delete(id)
            }
            const fullBuffer = Buffer.concat(buffers)
            this.#onMessageCompleteCallbacks.forEach(cb => {
                cb(remoteAddress, headers[0], fullBuffer)
            })
        }
    }
    onMessageComplete(callback: (remoteAddress: Address, header: UdpHeader, data: Buffer) => void) {
        this.#onMessageCompleteCallbacks.push(callback)
    }
}