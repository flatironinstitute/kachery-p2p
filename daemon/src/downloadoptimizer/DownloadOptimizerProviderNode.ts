import { NodeId } from "../interfaces/core";
import { byteCount, ByteCount, ByteCountPerSec, byteCountToNumber } from "../udp/UdpCongestionManager";
import RateEstimator from "./RateEstimator";

class DownloadOptimizerProviderNode {
    #nodeId: NodeId
    #currentFileDownloadJob = null // todo
    #numBytesDownloadedInCurrentJob: ByteCount = byteCount(0)
    #rateEstimator = new RateEstimator(); // todo
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
    // todo: type j
    setFileDownloadJob(j) {
        if (this.#currentFileDownloadJob === null) {
            throw Error('Unexpected: provider node already has a file download job')
        }
        this.#currentFileDownloadJob = j
        this.#numBytesDownloadedInCurrentJob = byteCount(0)
        this.#rateEstimator.reportStart();
        j.onProgress(({numBytes, totalBytes}) => {
            const deltaBytes = byteCount(numBytes - byteCountToNumber(this.#numBytesDownloadedInCurrentJob))
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