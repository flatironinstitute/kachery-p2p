import { NodeId } from "../interfaces/core";
import { LoadFileProgress } from "../KacheryP2PNode";
import { byteCount, ByteCount, byteCountToNumber } from "../udp/UdpCongestionManager";
import { Downloader } from "./DownloaderCreator";
import RateEstimator from "./RateEstimator";

class DownloadOptimizerProviderNode {
    #nodeId: NodeId
    #currentDownloader: Downloader | null = null
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
        return this.#currentDownloader ? true : false;
    }
    setDownloader(j: Downloader) {
        if (this.#currentDownloader !== null) {
            throw Error('Unexpected: provider node already has a file downloader')
        }
        this.#currentDownloader = j
        this.#numBytesDownloadedInCurrentDownloader = byteCount(0)
        this.#rateEstimator.reportStart();
        j.onProgress((progress: LoadFileProgress) => {
            const deltaBytes = byteCount(byteCountToNumber(progress.bytesLoaded) - byteCountToNumber(this.#numBytesDownloadedInCurrentDownloader))
            this.#numBytesDownloadedInCurrentDownloader = progress.bytesLoaded
            this.#rateEstimator.reportBytes(deltaBytes)
        });
        const _handleComplete = () => {
            this.#rateEstimator.reportStop()
            this.#currentDownloader = null
        }
        j.onError((err: Error) => {
            _handleComplete()
        });
        j.onFinished(() => {
            _handleComplete();
        });
    }
}

export default DownloadOptimizerProviderNode;