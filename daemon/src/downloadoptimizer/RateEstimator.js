const FILTER_TIME_CONSTANT_SEC = 10;

class RateEstimator {
    constructor() {
        this._lastTimestamp = new Date();
        this._currentEstimateTimestamp = new Date();
        this._currentEstimate = 1000000;
        this._running = false;
    }
    estimatedRateBps() {
        if (this._running) {
            this.reportBytes(0);
        }
        return this._currentEstimate;
    }
    reportStart() {
        if (this._running) {
            throw Error('Cannot start when already running');    
        }
        this._currentEstimateTimestamp = new Date();
        this._running = true;
    }
    reportStop() {
        if (!this._running) {
            throw Error('Cannot stop when not running');
        }
        this.reportBytes(0);
        this._running = false;
    }
    reportBytes(numBytes) {
        if (!this._running) {
            throw Error('Cannot report bytes when not running');
        }
        const elapsedSecSinceLastEstimate = ((new Date()) - this._currentEstimateTimestamp) / 1000;

        if (elapsedSecSinceLastEstimate > 0) {
            // update estimate based on numBytes, elapsedSinceLastEstimate
            const recentActivityEstimate = numBytes / elapsedSecSinceLastEstimate;
            const filterTimeConstant = FILTER_TIME_CONSTANT_SEC;
            const p = Math.exp(-elapsedSecSinceLastEstimate / filterTimeConstant);
            const newEstimate = recentActivityEstimate * (1 - p) + this._currentEstimate * p;
            this._currentEstimate = newEstimate;
        }

        this._currentEstimateTimestamp = new Date();
    }
}