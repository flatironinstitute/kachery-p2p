class DownloadOptimizerFile {
    constructor(fileKey) {
        this._fileKey = fileKey;
        this._currentFileDownloadJob = null;
        this._callbacks = {
            progress,
            error,
            finished
        }
    }
    fileKey() {
        return this._fileKey;
    }
    isDownloading() {
        return this._currentFileDownloadJob ? true : false;
    }
    onProgress(cb) {
        this._callbacks.progress.push(cb);
    }
    onError(cb) {
        this._callbacks.error.push(cb);
    }
    onFinished(cb) {
        this._callbacks.finished.push(cb);
    }
    setFileDownloadJob(j) {
        assert(this._currentFileDownloadJob === null, 'Unexpected: provider already has a file download job')
        this._currentFileDownloadJob = j;
        j.onProgress(({numBytes, totalBytes}) => {
            this._callbacks.progress.forEach(cb => cb({numBytes, totalBytes}));
        });
        const _handleComplete = () => {
            this._currentFileDownloadJob = null;
        }
        j.onError((err) => {
            _handleComplete();
            this._callbacks.error.forEach(cb => cb(err));
        });
        j.onFinished(() => {
            _handleComplete();
            this._callbacks.finished.forEach(cb => cb());
        });
    }
}

export default DownloadOptimizerFile;