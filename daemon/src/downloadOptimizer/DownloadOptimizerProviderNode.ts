import { ByteCount, NodeId } from "../interfaces/core";
import RateEstimator from "./RateEstimator";

class DownloadOptimizerProviderNode {
    #nodeId: NodeId
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
        return this.#rateEstimator.isRunning()
    }
    reportStart = () => {
        this.#rateEstimator.reportStart()
    }
    reportStop = () => {
        this.#rateEstimator.reportStop()
    }
    reportBytes = (n: ByteCount) => {
        this.#rateEstimator.reportBytes(n)
    }
}

export default DownloadOptimizerProviderNode;