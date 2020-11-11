import DataStreamy, { DataStreamyProgress } from "../common/DataStreamy";
import { byteCount, ByteCount, byteCountToNumber, NodeId } from "../interfaces/core";
import RateEstimator from "./RateEstimator";

class DownloadOptimizerProviderNode {
    #nodeId: NodeId
    #currentDownloaderProgress: DataStreamy | null = null
    #numBytesDownloadedInCurrentDownloader: ByteCount = byteCount(0)
    #rateEstimator = new RateEstimator();
    constructor(nodeId: NodeId) {
        this.#nodeId = nodeId
    }
    nodeId() {
        return this.#nodeId
    }
    estimatedRateBps() {
        return this.#rateEstimator.estimatedRateBps()
    }
    isDownloading() {
        return this.#currentDownloaderProgress ? true : false;
    }
    setDownloaderProgress(dp: DataStreamy) {
        if (this.#currentDownloaderProgress !== null) {
            /* istanbul ignore next */
            throw Error('Unexpected: provider node already has a file downloader')
        }
        this.#currentDownloaderProgress = dp
        this.#numBytesDownloadedInCurrentDownloader = byteCount(0)
        this.#rateEstimator.reportStart();
        dp.onProgress((progress: DataStreamyProgress) => {
            const deltaBytes = byteCount(byteCountToNumber(progress.bytesLoaded) - byteCountToNumber(this.#numBytesDownloadedInCurrentDownloader))
            this.#numBytesDownloadedInCurrentDownloader = progress.bytesLoaded
            this.#rateEstimator.reportBytes(deltaBytes)
        });
        const _handleComplete = () => {
            this.#rateEstimator.reportStop()
            this.#currentDownloaderProgress = null
        }
        dp.onError((err: Error) => {
            _handleComplete()
        });
        dp.onFinished(() => {
            _handleComplete();
        });
    }
}

export default DownloadOptimizerProviderNode;