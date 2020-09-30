import GarbageMap from '../common/GarbageMap'
import { MessagePartData, numPartsToNumber, partIndex, UdpHeader, UdpMessagePartId } from '../interfaces/UdpMessage'

export default class UdpMessagePartManager {
    #messageParts = new GarbageMap<UdpMessagePartId, MessagePartData>(3 * 60 * 1000)
    #onMessageCompleteCallbacks: ((header: UdpHeader, data: Buffer) => void)[] = []
    constructor() {}
    addMessagePart(udpMessagePartId: UdpMessagePartId, header: UdpHeader, buffer: Buffer) {
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
                cb(headers[0], fullBuffer)
            })
        }
    }
    onMessageComplete(callback: (header: UdpHeader, data: Buffer) => void) {
        this.#onMessageCompleteCallbacks.push(callback)
    }
}