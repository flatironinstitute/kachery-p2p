import { addByteCount, byteCount, ByteCount, NodeId } from "./interfaces/core";

type BytesSentMethod = 'multicastUdp' | 'udp' | 'http' | 'webSocket'
type BytesReceivedMethod = 'multicastUdp' | 'udp' | 'http' | 'webSocket'

export default class NodeStats {
    #totalBytesSent = {
        total: byteCount(0),
        multicastUdp: byteCount(0),
        udp: byteCount(0),
        http: byteCount(0),
        webSocket: byteCount(0)
    }
    #totalBytesReceived = {
        total: byteCount(0),
        multicastUdp: byteCount(0),
        udp: byteCount(0),
        http: byteCount(0),
        webSocket: byteCount(0)
    }
    constructor() {
    }
    totalBytesSent() {
        return {...this.#totalBytesSent}
    }
    totalBytesReceived() {
        return {...this.#totalBytesReceived}
    }
    reportBytesSent(method: BytesSentMethod, toNodeId: NodeId | null, numBytes: ByteCount) {
        this.#totalBytesSent[method] = addByteCount(this.#totalBytesSent[method], numBytes)
        this.#totalBytesSent['total'] = addByteCount(this.#totalBytesSent['total'], numBytes)
    }
    reportBytesReceived(method: BytesReceivedMethod, fromNodeId: NodeId | null, numBytes: ByteCount) {
        this.#totalBytesReceived[method] = addByteCount(this.#totalBytesReceived[method], numBytes)
        this.#totalBytesReceived['total'] = addByteCount(this.#totalBytesReceived['total'], numBytes)
    }
}