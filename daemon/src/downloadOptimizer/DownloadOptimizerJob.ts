import DataStreamy, { DataStreamyProgress } from "../common/DataStreamy";
import { ByteCount, byteCount, FileKey } from "../interfaces/core";

export default class DownloadOptimizerJob {
    #currentDownloader: {start: () => Promise<DataStreamy>, stop: () => void} | null = null
    #bytesLoaded = byteCount(0)
    #progressStream: DataStreamy = new DataStreamy()
    constructor(private fileKey_: FileKey, private fileSize_: ByteCount | null, private label_: string) {
    }
    fileKey() {
        return this.fileKey_
    }
    fileSize() {
        return this.fileSize_
    }
    label() {
        return this.label_
    }
    isDownloading() {
        return this.#currentDownloader ? true : false;
    }
    bytesLoaded() {
        return this.#bytesLoaded
    }
    cancel() {
        if (this.#currentDownloader) {
            this.#currentDownloader.stop()
        }
    }
    setDownloader(downloader: {start: () => Promise<DataStreamy>, stop: () => void}) {
        if (this.#currentDownloader !== null) {
            /* istanbul ignore next */
            throw Error('Unexpected: job already has a downloader')
        }
        this.#currentDownloader = downloader
        downloader.start().then((ds) => {
            ds.onStarted((size: ByteCount | null) => {
                this.#progressStream.producer().start(size)
            })
            ds.onProgress((progress: DataStreamyProgress) => {
                this.#bytesLoaded = progress.bytesLoaded
                this.#progressStream.producer().setProgress(progress)
            });
            const _handleComplete = () => {
                this.#currentDownloader = null
            }
            ds.onError((err: Error) => {
                _handleComplete();
                this.#progressStream.producer().error(err)
            });
            ds.onFinished(() => {
                _handleComplete();
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