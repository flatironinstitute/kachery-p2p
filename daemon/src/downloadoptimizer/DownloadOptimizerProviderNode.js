class DownloadOptimizerProviderNode {
    constructor({nodeId}) {
        this._nodeId = nodeId;
        this._currentFileDownloadJob = null;
        this._numBytesDownloadedInCurrentJob = 0;
        this._rateEstimator = new RateEstimator(); // todo
    }
    nodeId() {
        return this._nodeId;
    }
    estimatedRateBps() {
        return this._rateEstimator.estimatedRateBps();
    }
    hasFileDownloadJob() {
        return this._currentFileDownloadJob ? true : false;
    }
    setFileDownloadJob(j) {
        assert(this._currentFileDownloadJob === null, 'Unexpected: provider node already has a file download job')
        this._currentFileDownloadJob = j;
        this._numBytesDownloadedInCurrentJob = 0;
        this._rateEstimator.reportStart();
        j.onProgress(({numBytes, totalBytes}) => {
            const deltaBytes = numBytes - this._numBytesDownloadedInCurrentJob;
            this._numBytesDownloadedInCurrentJob = numBytes;
            this._rateEstimator.reportBytes(deltaBytes);
        });
        const _handleComplete = () => {
            this._rateEstimator.reportStop();
            this._currentFileDownloadJob = null;
        }
        j.onError((err) => {
            _handleComplete();
        });
        j.onFinished(() => {
            _handleComplete();
        });
    }

}

export default DownloadOptimizerProviderNode;