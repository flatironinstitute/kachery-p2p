import DataStreamy, { DataStreamyProgress } from "../common/DataStreamy";
import { ByteCount, byteCount, FileKey } from "../interfaces/core";

export default class DownloadOptimizerJob {
    #fileKey: FileKey
    #currentDownloader: {start: () => Promise<DataStreamy>} | null = null
    #currentDownloaderDataStream: DataStreamy | null = null
    #onProgressCallbacks: ((progress: DataStreamyProgress) => void)[] = []
    #onErrorCallbacks: ((err: Error) => void)[] = []
    #onFinishedCallbacks: (() => void)[] = []
    #numPointers = 0
    #bytesLoaded = byteCount(0)
    #fileSize: ByteCount | null
    #progressStream: DataStreamy = new DataStreamy()
    constructor(fileKey: FileKey, fileSize: ByteCount | null) {
        this.#fileKey = fileKey
        this.#fileSize = fileSize
    }
    fileKey() {
        return this.#fileKey
    }
    fileSize() {
        return this.#fileSize
    }
    incrementNumPointers() {
        this.#numPointers ++
    }
    decrementNumPointers() {
        this.#numPointers --
        if (this.#numPointers <= 0) {
            if (this.#currentDownloaderDataStream) {
                this.#currentDownloaderDataStream.cancel()
            }
        }
    }
    numPointers() {
        return this.#numPointers
    }
    isDownloading() {
        return this.#currentDownloader ? true : false;
    }
    bytesLoaded() {
        return this.#bytesLoaded
    }
    onProgress(cb: (progress: DataStreamyProgress) => void) {
        this.#onProgressCallbacks.push(cb)
    }
    onError(cb: (err: Error) => void) {
        this.#onErrorCallbacks.push(cb);
    }
    onFinished(cb: () => void) {
        this.#onFinishedCallbacks.push(cb);
    }
    setDownloader(downloader: {start: () => Promise<DataStreamy>}) {
        if (this.#currentDownloader !== null) {
            /* istanbul ignore next */
            throw Error('Unexpected: job already has a downloader')
        }
        downloader.start().then((ds) => {
            this.#currentDownloaderDataStream = ds
            ds.onStarted((size: ByteCount | null) => {
                this.#progressStream.producer().start(size)
            })
            ds.onProgress((progress: DataStreamyProgress) => {
                this.#bytesLoaded = progress.bytesLoaded
                this.#onProgressCallbacks.forEach(cb => cb(progress))
                this.#progressStream.producer().setProgress(progress)
            });
            const _handleComplete = () => {
                this.#currentDownloader = null
            }
            ds.onError((err: Error) => {
                _handleComplete();
                this.#onErrorCallbacks.forEach(cb => cb(err));
                this.#progressStream.producer().error(err)
            });
            ds.onFinished(() => {
                _handleComplete();
                this.#onFinishedCallbacks.forEach(cb => cb());
                this.#progressStream.producer().end()
            });
        }).catch((err) => {
            throw Error(`Error starting downloader: ${err.message}`)
        })
    }
    getProgressStream() {
        return this.#progressStream
    }
}