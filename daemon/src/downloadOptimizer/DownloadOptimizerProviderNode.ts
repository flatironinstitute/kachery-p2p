import { ByteCount, ChannelName, NodeId } from "../interfaces/core";
import RateEstimator from "./RateEstimator";

class DownloadOptimizerProviderNode {
    #nodeId: NodeId
    #channelName: ChannelName
    #rateEstimator = new RateEstimator();
    constructor(nodeId: NodeId, channelName: ChannelName) {
        this.#nodeId = nodeId
        this.#channelName = channelName
    }
    nodeId() {
        return this.#nodeId
    }
    channelName() {
        return this.#channelName
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