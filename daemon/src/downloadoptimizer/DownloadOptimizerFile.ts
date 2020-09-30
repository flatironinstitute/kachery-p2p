import { FileKey } from "../interfaces/core";
import { ByteCount } from "../udp/UdpCongestionManager";

export default class DownloadOptimizerFile {
    #fileKey: FileKey
    #currentFileDownloadJob = null
    #onProgressCallbacks: ((arg: {numBytes: ByteCount, totalBytes: ByteCount}) => void)[]
    #onErrorCallbacks: ((err: Error) => void)[]
    #onFinishedCallbacks: (() => void)[]
    constructor(fileKey: FileKey) {
        this.#fileKey = fileKey
    }
    fileKey() {
        return this.#fileKey;
    }
    isDownloading() {
        return this.#currentFileDownloadJob ? true : false;
    }
    onProgress(cb: (arg: {numBytes: ByteCount, totalBytes: ByteCount}) => void) {
        this.#onProgressCallbacks.push(cb)
    }
    onError(cb: (err: Error) => void) {
        this.#onErrorCallbacks.push(cb);
    }
    onFinished(cb: () => void) {
        this.#onFinishedCallbacks.push(cb);
    }
    // todo: type of j
    setFileDownloadJob(j) {
        if (this.#currentFileDownloadJob === null) {
            throw Error('Unexpected: provider already has a file download job')
        }
        this.#currentFileDownloadJob = j;
        j.onProgress(({numBytes, totalBytes}) => {
            this.#onProgressCallbacks.forEach(cb => cb({numBytes, totalBytes}));
        });
        const _handleComplete = () => {
            this.#currentFileDownloadJob = null;
        }
        j.onError((err) => {
            _handleComplete();
            this.#onErrorCallbacks.forEach(cb => cb(err));
        });
        j.onFinished(() => {
            _handleComplete();
            this.#onFinishedCallbacks.forEach(cb => cb());
        });
    }
}