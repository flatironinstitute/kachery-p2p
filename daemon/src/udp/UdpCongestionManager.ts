import { randomAlphaString } from "../common/util"
import { elapsedSince, isNumber, isString, nowTimestamp } from "../interfaces/core";

const TARGET_PCT_LOST_BYTES = 2;

export const _tests: {[key: string]: () => Promise<void>} = {}

type Callbacks = (() => void)[]

export interface ByteCount extends Number {
    __byteCount__: never
}
export const exampleByteCount = 4000 as any as ByteCount
export const isByteCount = (x: any) : x is ByteCount => {
    if (!isNumber(x)) return false;
    if (x < 0) return false;
    return true;
}
export const byteCountToNumber = (x: ByteCount): number => {
    return x as any as number;
}
export const byteCount = (n: number) => {
    return n as any as ByteCount
}
const addByteCount = (n1: ByteCount, n2: ByteCount) => {
    return byteCount(byteCountToNumber(n1) + byteCountToNumber(n2))
}

export interface ByteCountPerSec extends Number {
    __byteCountPerSec__: never
}
export const exampleByteCountPerSec = 400 as any as ByteCountPerSec
export const isByteCountPerSec = (x: any) : x is ByteCountPerSec => {
    if (!isNumber(x)) return false
    if (x < 0) return false
    return true
}
export const byteCountPerSecToNumber = (x: ByteCountPerSec): number => {
    return x as any as number;
}
export const byteCountPerSec = (n: number) => {
    return n as any as ByteCountPerSec
}

export interface PacketCount extends Number {
    __packetCount__: never
}
export const examplePacketCount = 40 as any as PacketCount
export const isPacketCount = (x: any) : x is PacketCount => {
    if (!isNumber(x)) return false;
    if (x < 0) return false;
    return true;
}
export const packetCountToNumber = (x: PacketCount): number => {
    return x as any as number;
}
export const packetCount = (n: number) => {
    return n as any as PacketCount
}
const addPacketCount = (n1: PacketCount, n2: PacketCount) => {
    return packetCount(packetCountToNumber(n1) + packetCountToNumber(n2))
}

export interface DurationMsec extends Number {
    __durationMsec__: never
}
export const exampleDurationMsec = 3000 as any as DurationMsec
export const isDurationMsec = (x: any) : x is DurationMsec => {
    if (!isNumber(x)) return false;
    if (x < 0) return false;
    return true;
}
export const durationMsecToNumber = (x: DurationMsec): number => {
    return x as any as number;
}
export const durationMsec = (n: number) => {
    return n as any as DurationMsec
}

type SendCallback = (onConfirmed: () => void, onTimedOut: () => void, onError: () => void, opts: {timeoutMsec: number}) => void
interface QueuedPacket {
    internalId: InternalId,
    packetSize: ByteCount,
    send: SendCallback
}

export interface InternalId extends String {
    __internalId__: never // phantom type
}
const exampleInternalId: InternalId = "internalId" as any as InternalId
export const isInternalId = (x: any): x is InternalId => {
    if (!isString(x)) return false;
    return (/^[A-Fa-f]{10}?$/.test(x));
}
export const createInternalId = () => {
    return randomAlphaString(10) as any as InternalId;
}

export default class UdpCongestionManager {
    #maxNumBytesPerSecondToSend = byteCountPerSec(3 * 1000 * 1000) // current number of bytes per second allowed to send
    #estimatedRoundtripLatencyMsec = durationMsec(200) // current estimated roundtrip latency
    #trialDurationMsec = durationMsec(5000); // duration of a single trial
    #currentTrialData = new TrialData();
    #queuedPackets = new Queue<QueuedPacket>()
    constructor() {}
     queuePacket(packetSize: ByteCount, send: SendCallback) {
        this.#queuedPackets.enqueue({
            internalId: createInternalId(),
            packetSize,
            send
        })
        this._handleNextPackets()
    }
    _sendPacket(p: QueuedPacket) {
        const timer = nowTimestamp()
        const _onConfirmed = () => {
            const elapsedMsec = durationMsec(elapsedSince(timer))
            this.#currentTrialData.reportConfirmed(p.internalId, p.packetSize, elapsedMsec)
            this._handleNextPackets()
        }
        const _onTimedOut = () => {
            this.#currentTrialData.reportTimedOut(p.internalId, p.packetSize)
            this._handleNextPackets()
        }
        const _onError = () => {
            this.#currentTrialData.reportError(p.internalId, p.packetSize)
            this._handleNextPackets()
        }
        p.send(_onConfirmed, _onTimedOut, _onError, {timeoutMsec: durationMsecToNumber(this.#estimatedRoundtripLatencyMsec) * 5})
        this.#currentTrialData.reportSent(p.internalId, p.packetSize)
        this._handleNextPackets()
    }
    _handleNextPackets() {
        if (this.#currentTrialData.elapsedMsec() > durationMsecToNumber(this.#trialDurationMsec)) {
            this.#estimatedRoundtripLatencyMsec = this.#currentTrialData.estimateRoundtripLatency(this.#estimatedRoundtripLatencyMsec)
            this.#maxNumBytesPerSecondToSend = this.#currentTrialData.determineMaxNumBytesPerSecondToSend(this.#maxNumBytesPerSecondToSend, this.#estimatedRoundtripLatencyMsec)
            this.#currentTrialData.reset()
        }
        while (this._handleNextPacket());
    }
    _handleNextPacket(): boolean {
        if (this.#queuedPackets.isEmpty()) {
            return false;
        }
        const p = this.#queuedPackets.peek()
        const packetSize = p.packetSize
        const numUnconfirmedBytes = this.#currentTrialData.computeNumUnconfirmedBytes()

        // determine how many unconfirmed bytes we are allowed to have at any given moment
        const maxNumUnconfirmedBytesAllowed = byteCount(byteCountPerSecToNumber(this.#maxNumBytesPerSecondToSend) / 1000 * durationMsecToNumber(this.#estimatedRoundtripLatencyMsec))
        if (numUnconfirmedBytes < maxNumUnconfirmedBytesAllowed) {
            this.#queuedPackets.dequeue()
            this._sendPacket(p)
            return true
        }
        else {
            return false
        }
    }
}

class TrialData {
    #timestampStarted = nowTimestamp()
    #sentPacketInternalIds = new Map<InternalId, boolean>()
    #numSentPackets: PacketCount
    #numSentBytes: ByteCount
    #numConfirmedPackets: PacketCount
    #numConfirmedBytes: ByteCount
    #numTimedOutPackets: PacketCount
    #numTimedOutBytes: ByteCount
    #numErrorPackets: PacketCount
    #numErrorBytes: ByteCount
    #roundtripLatenciesMsec: DurationMsec[]
    #peakNumUnconfirmedBytes: ByteCount
    constructor() {
        this.reset()
    }
    reset() {
        this.#timestampStarted = nowTimestamp()
        this.#sentPacketInternalIds.clear()
        this.#numSentPackets = packetCount(0)
        this.#numSentBytes = byteCount(0)
        this.#numConfirmedPackets = packetCount(0)
        this.#numConfirmedBytes = byteCount(0)
        this.#numTimedOutPackets = packetCount(0)
        this.#numTimedOutBytes = byteCount(0)
        this.#numErrorPackets = packetCount(0)
        this.#numErrorBytes = byteCount(0)
        this.#roundtripLatenciesMsec = [] // update this
        this.#peakNumUnconfirmedBytes = byteCount(0)
    }
    computeNumUnconfirmedBytes() {
        return byteCount(
            byteCountToNumber(this.#numSentBytes) -
            byteCountToNumber(this.#numConfirmedBytes) -
            byteCountToNumber(this.#numTimedOutBytes) -
            byteCountToNumber(this.#numErrorBytes)
        )
    }
    reportSent(internalId: InternalId, packetSize: ByteCount) {
        this.#numSentPackets = addPacketCount(this.#numSentPackets, packetCount(1))
        this.#numSentBytes = addByteCount(this.#numSentBytes, packetSize)
        this.#sentPacketInternalIds.set(internalId, true)
        const u = this.computeNumUnconfirmedBytes()
        if (u > this.#peakNumUnconfirmedBytes) {
            this.#peakNumUnconfirmedBytes = u
        }
    }
    reportConfirmed(internalId: InternalId, packetSize: ByteCount, roundTripLatencyMsec: DurationMsec) {
        if (this.#sentPacketInternalIds.has(internalId)) {
            this.#numConfirmedPackets = addPacketCount(this.#numConfirmedPackets, packetCount(1))
            this.#numConfirmedBytes = addByteCount(this.#numConfirmedBytes, packetSize)
            this.#roundtripLatenciesMsec.push(roundTripLatencyMsec)
        }
    }
    reportTimedOut(internalId: InternalId, packetSize: ByteCount) {
        if (this.#sentPacketInternalIds.has(internalId)) {
            this.#numTimedOutPackets = addPacketCount(this.#numTimedOutPackets, packetCount(1))
            this.#numTimedOutBytes = addByteCount(this.#numTimedOutBytes, packetSize)
        }
    }
    reportError(internalId: InternalId, packetSize: ByteCount) {
        if (this.#sentPacketInternalIds.has(internalId)) {
            this.#numErrorPackets = addPacketCount(this.#numErrorPackets, packetCount(1))
            this.#numErrorBytes = addByteCount(this.#numErrorBytes, packetSize)
        }
    }
    estimateRoundtripLatency(oldEstimateMsec: DurationMsec): DurationMsec {
        if (this.#roundtripLatenciesMsec.length < 5) {
            // not enough to estimate
            return oldEstimateMsec
        }
        // adjust the round-trip latency by taking a weighted average of existing estimate with new estimate (median)
        const alpha = 0.3 // how much to weight the new estimate
        let estimatedRoundtripLatencyMsec = durationMsec(median(this.#roundtripLatenciesMsec.map(l => durationMsecToNumber(l))) * alpha + durationMsecToNumber(oldEstimateMsec) * (1 - alpha))

        // constrain the estimate
        const minEstLatency = durationMsec(20)
        const maxEstLatency = durationMsec(1000)
        if (durationMsecToNumber(estimatedRoundtripLatencyMsec) < durationMsecToNumber(minEstLatency)) estimatedRoundtripLatencyMsec = minEstLatency
        if (durationMsecToNumber(estimatedRoundtripLatencyMsec) > durationMsecToNumber(maxEstLatency)) estimatedRoundtripLatencyMsec = maxEstLatency
        return estimatedRoundtripLatencyMsec
    }
    determineMaxNumBytesPerSecondToSend(oldMaxNumBytesPerSecondToSend: ByteCountPerSec, estimatedRoundtripLatencyMsec: DurationMsec): ByteCountPerSec {
        if (byteCountToNumber(this.#numSentBytes) < 10 * 1000) {
            // not enough bytes sent
            return oldMaxNumBytesPerSecondToSend
        }

        // The target of % bytes we want to lose
        const targetPctLostBytes = TARGET_PCT_LOST_BYTES;

        let maxNumBytesPerSecondToSend = oldMaxNumBytesPerSecondToSend

        // Percentage of lost bytes
        const pctConfirmedBytes = (byteCountToNumber(this.#numConfirmedBytes) / byteCountToNumber(this.#numSentBytes)) * 100;
        const pctLostBytes = 1 - pctConfirmedBytes
        if (pctLostBytes < targetPctLostBytes) {
            // didn't lose enough bytes... let's see if we were actually limited
            // calculate the expected peak number of outstanding bytes if we were at full load
            const a = byteCountPerSecToNumber(oldMaxNumBytesPerSecondToSend) / 1000 * durationMsecToNumber(estimatedRoundtripLatencyMsec)
            if (byteCountToNumber(this.#peakNumUnconfirmedBytes) > 0.6 * a) {
                // it looks like we were indeed limited
                // okay, let's increase the rate
                maxNumBytesPerSecondToSend = byteCountPerSec(byteCountPerSecToNumber(maxNumBytesPerSecondToSend) * 1.2)
            }
        }
        else {
            // We lost too many bytes, so let's decrease the rate
            // question: should we check whether the loss was likely due to rate?
            maxNumBytesPerSecondToSend = byteCountPerSec(byteCountPerSecToNumber(maxNumBytesPerSecondToSend) / 1.2)
        }

        if (pctLostBytes < 20) {
            // don't let the rate get too low
            const lowerBound = byteCountPerSec(1 * 1000 * 1000)
            if (byteCountPerSecToNumber(maxNumBytesPerSecondToSend) < byteCountPerSecToNumber(lowerBound)) {
                maxNumBytesPerSecondToSend = lowerBound;
            }
        }
        return maxNumBytesPerSecondToSend
    }
    elapsedMsec() {
        return elapsedSince(this.#timestampStarted)
    }
}

class Queue<T> extends Array {
    enqueue(val: T) {
        this.push(val)
    }

    dequeue(): T {
        return this.shift()
    }

    peek(): T {
        return this[0]
    }

    isEmpty(): boolean {
        return this.length === 0
    }
}

const median = (x: number[]) => {
    const values = [...x];
    values.sort(function (a, b) { return a - b; });
    var half = Math.floor(values.length / 2);
    if (values.length % 2)
        return values[half];
    else
        return (values[half - 1] + values[half]) / 2.0;
}

_tests.UdpCongestionManager = async () => {
    return new Promise((resolve, reject) => {
        const x = new UdpCongestionManager()
        let numSent = 0
        const _check = () => {
            if (numSent === 3) {
                resolve()
            }
        }
        const send = (onConfirmed: () => void, onTimedOut: () => void, onError: () => void, opts: {timeoutMsec: number}) => {
            onConfirmed()
            numSent ++
            _check()
        }
        x.queuePacket(byteCount(100), send)
        x.queuePacket(byteCount(100), send)
        x.queuePacket(byteCount(100), send)
    })
}