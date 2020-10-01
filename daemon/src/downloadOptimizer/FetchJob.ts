class FetchJob {
    constructor({
        chunk,
        provider,
        startByte,
        endByte
    }) {
        this._chunk = chunk;
        this._provider = provider;
        this._startByte = startByte;
        this._endByte = endByte;

        this._callbacks = {
            progress: [],
            error: [],
            finished: []
        }
        this._start();
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
    async _start() {
        // todo
    }
}
