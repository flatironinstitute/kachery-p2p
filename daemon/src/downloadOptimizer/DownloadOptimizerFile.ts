import { FileKey } from "../interfaces/core";
import { ByteCount } from "../udp/UdpCongestionManager";
import { FileDownloadJob } from './DownloadOptimizer';

export default class DownloadOptimizerFile {
    #fileKey: FileKey
    #currentFileDownloadJob: FileDownloadJob | null = null
    #onProgressCallbacks: ((numBytes: ByteCount, totalBytes: ByteCount) => void)[]
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
    onProgress(cb: (numBytes: ByteCount, totalBytes: ByteCount) => void) {
        this.#onProgressCallbacks.push(cb)
    }
    onError(cb: (err: Error) => void) {
        this.#onErrorCallbacks.push(cb);
    }
    onFinished(cb: () => void) {
        this.#onFinishedCallbacks.push(cb);
    }
    setFileDownloadJob(j: FileDownloadJob) {
        if (this.#currentFileDownloadJob === null) {
            throw Error('Unexpected: provider already has a file download job')
        }
        this.#currentFileDownloadJob = j;
        j.onProgress((numBytes: ByteCount, totalBytes: ByteCount) => {
            this.#onProgressCallbacks.forEach(cb => cb(numBytes, totalBytes));
        });
        const _handleComplete = () => {
            this.#currentFileDownloadJob = null;
        }
        j.onError((err: Error) => {
            _handleComplete();
            this.#onErrorCallbacks.forEach(cb => cb(err));
        });
        j.onFinished(() => {
            _handleComplete();
            this.#onFinishedCallbacks.forEach(cb => cb());
        });
    }
}