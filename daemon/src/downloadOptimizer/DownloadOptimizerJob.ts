import { FileKey } from "../interfaces/core";
import { LoadFileProgress } from '../KacheryP2PNode';
import { ByteCount, byteCount } from "../udp/UdpCongestionManager";
import { Downloader } from "./DownloaderCreator";

export default class DownloadOptimizerJob {
    #fileKey: FileKey
    #currentDownloader: Downloader | null = null
    #onProgressCallbacks: ((progress: LoadFileProgress) => void)[] = []
    #onErrorCallbacks: ((err: Error) => void)[] = []
    #onFinishedCallbacks: (() => void)[] = []
    #numPointers = 0
    #bytesLoaded = byteCount(0)
    #fileSize: ByteCount | null
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
            if (this.#currentDownloader) {
                this.#currentDownloader.cancel()
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
    onProgress(cb: (progress: LoadFileProgress) => void) {
        this.#onProgressCallbacks.push(cb)
    }
    onError(cb: (err: Error) => void) {
        this.#onErrorCallbacks.push(cb);
    }
    onFinished(cb: () => void) {
        this.#onFinishedCallbacks.push(cb);
    }
    setDownloader(downloader: Downloader) {
        if (this.#currentDownloader !== null) {
            /* istanbul ignore next */
            throw Error('Unexpected: job already has a downloader')
        }
        this.#currentDownloader = downloader
        downloader.onProgress((progress: LoadFileProgress) => {
            this.#bytesLoaded = progress.bytesLoaded
            this.#onProgressCallbacks.forEach(cb => cb(progress));
        });
        const _handleComplete = () => {
            this.#currentDownloader = null;
        }
        downloader.onError((err: Error) => {
            _handleComplete();
            this.#onErrorCallbacks.forEach(cb => cb(err));
        });
        downloader.onFinished(() => {
            _handleComplete();
            this.#onFinishedCallbacks.forEach(cb => cb());
        });
    }
}