class Provider {
    constructor() {
        this._currentChunkDownloadJob = null;
        this._numBytesDownloadedInCurrentJob = 0;
        this._rateEstimator = new RateEstimator(); // todo
    }
    estimatedRateBps() {
        return this._rateEstimator.estimatedRateBps();
    }
    hasChunkDownloadJob() {
        return this._currentChunkDownloadJob ? true : false;
    }
    setChunkDownloadJob(j) {
        assert(this._currentChunkDownloadJob === null, 'Unexpected: provider already has a chunk download job')
        this._currentChunkDownloadJob = j;
        this._numBytesDownloadedInCurrentJob = 0;
        this._rateEstimator.reportStart();
        j.onProgress(({numBytes, totalBytes}) => {
            const deltaBytes = numBytes - this._numBytesDownloadedInCurrentJob;
            this._numBytesDownloadedInCurrentJob = numBytes;
            this._rateEstimator.reportBytes(deltaBytes);
        });
        const _handleComplete = () => {
            this._rateEstimator.reportStop();
            this._currentChunkDownloadJob = null;
        }
        j.onError((err) => {
            _handleComplete();
        });
        j.onFinished(() => {
            _handleComplete();
        });
    }

}