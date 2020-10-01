import { NodeId } from "../interfaces/core";
import { byteCount, ByteCount, byteCountToNumber } from "../udp/UdpCongestionManager";
import { FileDownloadJob } from "./DownloadOptimizer";
import RateEstimator from "./RateEstimator";

class DownloadOptimizerProviderNode {
    #nodeId: NodeId
    #currentFileDownloadJob: FileDownloadJob | null = null
    #numBytesDownloadedInCurrentJob: ByteCount = byteCount(0)
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
    hasFileDownloadJob() {
        return this.#currentFileDownloadJob ? true : false;
    }
    setFileDownloadJob(j: FileDownloadJob) {
        if (this.#currentFileDownloadJob === null) {
            throw Error('Unexpected: provider node already has a file download job')
        }
        this.#currentFileDownloadJob = j
        this.#numBytesDownloadedInCurrentJob = byteCount(0)
        this.#rateEstimator.reportStart();
        j.onProgress((numBytes, totalBytes) => {
            const deltaBytes = byteCount(byteCountToNumber(numBytes) - byteCountToNumber(this.#numBytesDownloadedInCurrentJob))
            this.#numBytesDownloadedInCurrentJob = numBytes
            this.#rateEstimator.reportBytes(deltaBytes)
        });
        const _handleComplete = () => {
            this.#rateEstimator.reportStop()
            this.#currentFileDownloadJob = null
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