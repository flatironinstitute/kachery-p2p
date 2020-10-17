import { byteCount, ByteCount, byteCountToNumber } from "../udp/UdpCongestionManager"

export interface DataStreamyProgress {
    bytesLoaded: ByteCount,
    bytesTotal: ByteCount
}

export default class DataStreamy {
    #completed = false
    #finished = false
    #started = false
    #size: ByteCount | null = null
    #bytesLoaded: ByteCount = byteCount(0)
    #error: Error | null = null
    #onStartedCallbacks: ((size: ByteCount | null) => void)[] = []
    #onDataCallbacks: ((data: Buffer) => void)[] = []
    #onFinishedCallbacks: (() => void)[] = []
    #onCompleteCallbacks: (() => void)[] = []
    #onErrorCallbacks: ((err: Error) => void)[] = []
    #onProgressCallbacks: ((progress: DataStreamyProgress) => void)[] = []
    #cancelled = false
    #_onCancelCallbacks: (() => void)[] = []
    constructor() {}
    onStarted(callback: ((size: ByteCount | null) => void)) {
        if (this.#started) {
            callback(this.#size)
        }
        this.#onStartedCallbacks.push(callback)
    }
    onData(callback: ((data: Buffer) => void)) {
        this.#onDataCallbacks.push(callback)
    }
    async allData(): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const buffers: Buffer[] = []
            this.onData(buf => buffers.push(buf))
            this.onFinished(() => {
                resolve(Buffer.concat(buffers))
            })
            this.onError((err) => {
                reject(err)
            })
        })
    }
    onFinished(callback: (() => void)) {
        if (this.#finished) {
            callback()
        }
        this.#onFinishedCallbacks.push(callback)
    }
    onError(callback: ((err: Error) => void)) {
        if (this.#error) {
            callback(this.#error)
        }
        this.#onErrorCallbacks.push(callback)
    }
    onComplete(callback: (() => void)) {
        this.#onCompleteCallbacks.push(callback)
    }
    onProgress(callback: (progress: DataStreamyProgress) => void) {
        if ((byteCountToNumber(this.#bytesLoaded) > 0) && (this.#size)) {
            callback({bytesLoaded: this.#bytesLoaded, bytesTotal: this.#size})
        }
        this.#onProgressCallbacks.push(callback)
    }
    cancel() {
        if (this.#cancelled) return
        this.#cancelled = true
        this.#_onCancelCallbacks.forEach(cb => {
            cb()
        })
        this._error(Error('Cancelled'))
    }
    isComplete() {
        return this.#completed
    }
    _error(err: Error) {
        if (this.#completed) return
        this.#completed = true
        this.#error = err
        this.#onErrorCallbacks.forEach(cb => {cb(err)})
        this.#onCompleteCallbacks.forEach(cb => {cb()})
    }
    _start(size: ByteCount | null) {
        if (this.#completed) return
        if (this.#started) return
        this.#started = true
        this.#size = size
        this.#onStartedCallbacks.forEach(cb => {
            cb(size)
        })
    }
    _end() {
        if (this.#completed) return
        this.#completed = true
        this.#finished = true
        this.#onFinishedCallbacks.forEach(cb => {cb()})
        this.#onCompleteCallbacks.forEach(cb => {cb()})
    }
    _data(buf: Buffer) {
        if (this.#completed) return
        if (!this.#started) {
            this.#started = true
            this.#onStartedCallbacks.forEach(cb => {
                cb(null)
            })
        }
        this.#onDataCallbacks.forEach(cb => {
            cb(buf)
        })
        this._incrementBytes(byteCount(buf.length))
    }
    _incrementBytes(numBytes: ByteCount) {
        this._reportBytesLoaded(byteCount(byteCountToNumber(this.#bytesLoaded) + byteCountToNumber(numBytes)))
    }
    _reportBytesLoaded(numBytes: ByteCount) {
        this.#bytesLoaded = numBytes
        const s = this.#size
        if (s !== null) {
            this.#onProgressCallbacks.forEach(cb => {
                cb({bytesLoaded: this.#bytesLoaded, bytesTotal: s})
            })
        }
    }
    _onCancel(cb: () => void) {
        this.#_onCancelCallbacks.push(cb)
    }
}