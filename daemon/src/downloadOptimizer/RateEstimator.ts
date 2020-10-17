import { ByteCount, byteCount, byteCountToNumber, elapsedSince, nowTimestamp, Timestamp } from "../interfaces/core";
import { byteCountPerSec, ByteCountPerSec, byteCountPerSecToNumber } from "../udp/UdpCongestionManager";

const FILTER_TIME_CONSTANT_SEC = 10;

export default class RateEstimator {
    #lastTimestamp: Timestamp = nowTimestamp()
    #currentEstimateTimestamp: Timestamp = nowTimestamp()
    #currentEstimate: ByteCountPerSec = byteCountPerSec(1000 * 1000)
    #running: boolean = false
    constructor() {
    }
    estimatedRateBps() {
        if (this.#running) {
            this.reportBytes(byteCount(0))
        }
        return this.#currentEstimate
    }
    reportStart() {
        if (this.#running) {
            /* istanbul ignore next */
            throw Error('Cannot start when already running');    
        }
        this.#currentEstimateTimestamp = nowTimestamp();
        this.#running = true;
    }
    reportStop() {
        if (!this.#running) {
            /* istanbul ignore next */
            throw Error('Cannot stop when not running');
        }
        this.reportBytes(byteCount(0));
        this.#running = false;
    }
    reportBytes(numBytes: ByteCount) {
        if (!this.#running) {
            /* istanbul ignore next */
            throw Error('Cannot report bytes when not running');
        }
        const elapsedSecSinceLastEstimate = elapsedSince(this.#currentEstimateTimestamp) / 1000;

        if (elapsedSecSinceLastEstimate > 0) {
            // update estimate based on numBytes, elapsedSinceLastEstimate
            const recentActivityEstimate = byteCountToNumber(numBytes) / elapsedSecSinceLastEstimate;
            const filterTimeConstant = FILTER_TIME_CONSTANT_SEC;
            const p = Math.exp(-elapsedSecSinceLastEstimate / filterTimeConstant);
            const newEstimate = recentActivityEstimate * (1 - p) + byteCountPerSecToNumber(this.#currentEstimate) * p;
            this.#currentEstimate = byteCountPerSec(newEstimate)
        }

        this.#currentEstimateTimestamp = nowTimestamp();
    }
}