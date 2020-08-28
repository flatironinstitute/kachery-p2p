class Chunk {
    constructor(chunkId, info) {
        this._chunkId = chunkId;
        this._info = info;
        this._currentChunkDownloadJob = null;
        this._callbacks = {
            progress,
            error,
            finished
        }
    }
    numBytes() {
        return self._info.numBytes;
    }
    isDownloading() {
        return this._currentChunkDownloadJob ? true : false;
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
    setChunkDownloadJob(j) {
        assert(this._currentChunkDownloadJob === null, 'Unexpected: provider already has a chunk download job')
        this._currentChunkDownloadJob = j;
        j.onProgress(({numBytes, totalBytes}) => {
            this._callbacks.progress.forEach(cb => cb({numBytes, totalBytes}));
        });
        const _handleComplete = () => {
            this._currentChunkDownloadJob = null;
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