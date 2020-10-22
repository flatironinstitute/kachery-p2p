import GarbageMap from '../common/GarbageMap'
import { Address, durationMsec, NodeId } from '../interfaces/core'
import { MessagePartData, NumParts, numPartsToNumber, partIndex, PartIndex, UdpHeader, UdpMessageId, udpMessagePartId, UdpMessagePartId } from '../interfaces/UdpMessage'

export default class UdpMessagePartManager {
    #messageParts = new GarbageMap<UdpMessagePartId, MessagePartData>(durationMsec(30 * 60 * 1000))
    #remoteAddressesByNodeId = new GarbageMap<NodeId, Address>(durationMsec(30 * 60 * 1000))
    #onMessageCompleteCallbacks: ((header: UdpHeader, data: Buffer) => void)[] = []
    constructor() {}
    addMessagePart(remoteAddress: Address | null, udpMessageId: UdpMessageId, partInd: PartIndex, numParts: NumParts, header: UdpHeader, buffer: Buffer) {
        this.#messageParts.set(udpMessagePartId(udpMessageId, partInd, numParts), {header, buffer})
        let complete = true
        const buffers: Buffer[] = []
        const headers: UdpHeader[] = [] 
        for (let i = 0; i < numPartsToNumber(numParts); i++) {
            const d = this.#messageParts.get(udpMessagePartId(udpMessageId, partIndex(i), numParts))
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
            for (let i = 0; i < numPartsToNumber(numParts); i++) {
                this.#messageParts.delete(udpMessagePartId(udpMessageId, partIndex(i), numParts))
            }
            const fullBuffer = Buffer.concat(buffers)
            this.#onMessageCompleteCallbacks.forEach(cb => {
                cb(headers[0], fullBuffer)
            })
        }
        if (remoteAddress) {
            this.#remoteAddressesByNodeId.set(header.body.fromNodeId, remoteAddress)
        }
    }
    onMessageComplete(callback: (header: UdpHeader, data: Buffer) => void) {
        this.#onMessageCompleteCallbacks.push(callback)
    }
    getRemoteAddressForNodeId(nodeId: NodeId): Address | null {
        return this.#remoteAddressesByNodeId.get(nodeId) || null
    }
}