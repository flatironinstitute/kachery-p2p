import DownloadOptimizerFile from "./DownloadOptimizerFile.js";
import DownloadOptimizerProviderNode from "./DownloadOptimizerProviderNode.js";

const { JSONStringifyDeterministic } = require("../common/crypto_util");

class DownloadOptimizer {
    constructor(jobCreator) {
        this._files = {}; // by fileKeyHash
        this._providerNodes = {}; // by nodeId
        this._providerNodesForFiles = {}; // by fileId, by nodeId
        this._jobCreator = jobCreator;

        this._maxNumSimultaneousFileDownloads = 5;
        this._updateScheduled = false;
    }
    addFile(fileKey) {
        const fileKeyHash = JSONStringifyDeterministic(fileKey);
        if (fileKeyHash in this._files) {
            return this._files[fileKeyHash];
        }
        const f = new DownloadOptimizerFile(fileKey);
        this._files[fileKeyHash] = f;
        f.onError(() => {
            delete this._files[fileKeyHash];
        });
        c.onFinished(() => {
            delete this._files[fileKeyHash];
        });
        this._scheduleUpdate();
        return f;
    }
    setProviderNodeForFile({ fileKey, nodeId }) {
        const fileKeyHash = JSONStringifyDeterministic(fileKey);
        if (!(nodeId in this._providerNodes)) {
            const p = new DownloadOptimizerProviderNode(nodeId);
            this._providerNodes[nodeId] = p;
        }
        if (!this._providerNodesForFiles[fileKeyHash]) {
            this._providerNodesForFiles[fileKeyHash] = {};
        }
        this._providerNodesForFiles[fileKeyHash][nodeId] = true;
        this._scheduleUpdate();
    }
    _scheduleUpdate() {
        if (this._updateScheduled) return;
        this._updateScheduled = true;
        setTimeout(() => {
            this._updateScheduled = false;
            this._update();
        }, 1);
    }
    _update() {
        let numActiveFileDownloads = 0;
        for (let fileKeyHash in this._files) {
            const file = this._files[fileKeyHash];
            if (file.isDownloading()) {
                numActiveFileDownloads++;
            }
        }
        let numActiveFileDownloads = Object.keys(this._files).filter(k => this._files[k].isDownloading()).length;
        if (numActiveFileDownloads < this._maxNumSimultaneousFileDownloads) {
            for (let fileKeyHash in this._files) {
                const file = this._files[fileKeyHash];
                if (numActiveFileDownloads < this._maxNumSimultaneousFileDownloads) {
                    const providerNodeCandidates = [];
                    for (let providerNodeId in (this._providerNodesForFiles[fileKeyHash] || {})) {
                        const providerNode = this._providerNodes[providerNodeId];
                        if (!providerNode.hasFileDownloadJob()) {
                            providerNodeCandidates.push(providerNode);
                        }
                    }
                    const providerNode = chooseFastestProviderNode(providerNodeCandidates);
                    if (providerNode) {
                        const fileDownloadJob = this._jobCreator.createFileDownloadJob({ fileKey: file.fileKey(), nodeId: providerNode.nodeId() }); // todo
                        file.setFileDownloadJob(fileDownloadJob);
                        providerNode.setFileDownloadJob(fileDownloadJob);
                        numActiveFileDownloads++;
                    }
                }
            }
        }
    }
}

const chooseFastestProviderNode = (providerNodeList) => {
    if (providerNodeList.length === 0) {
        return null;
    }
    const estimatedRates = providerNodeList.map(p => p.estimatedRateBps());
    const bestIndex = argMax(estimatedRates);
    return providerNodeList[bestIndex];
}


// thanks: https://gist.github.com/engelen/fbce4476c9e68c52ff7e5c2da5c24a28
function argMax(array) {
    return array.map((x, i) => [x, i]).reduce((r, a) => (a[0] > r[0] ? a : r))[1];
}

export default DownloadOptimizer;