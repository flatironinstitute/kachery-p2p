import { FileKey, NodeId } from "../interfaces/core";
import DownloadOptimizerFile from "./DownloadOptimizerFile";
import DownloadOptimizerProviderNode from "./DownloadOptimizerProviderNode";

export default class DownloadOptimizer {
    #files = new Map<FileKey, DownloadOptimizerFile>()
    #providerNodes = new Map<NodeId, DownloadOptimizerProviderNode>()
    #providerNodesForFiles = new Map<FileKey, Set<NodeId>>()
    #jobCreator
    #maxNumSimultaneousFileDownloads = 5
    #updateScheduled = false
    // todo: type jobCreator
    constructor(jobCreator) {
        this.#jobCreator = jobCreator
    }
    addFile(fileKey: FileKey) {
        const f = new DownloadOptimizerFile(fileKey)
        this.#files.set(fileKey, f)
        f.onError(() => {
            this.#files.delete(fileKey)
        });
        f.onFinished(() => {
            this.#files.delete(fileKey)
        });
        this._scheduleUpdate();
        return f;
    }
    setProviderNodeForFile({ fileKey, nodeId }) {
        this.#providerNodes.forEach((n: DownloadOptimizerProviderNode, nodeId: NodeId) => {
            if (!this.#providerNodes.has(nodeId)) {
                const p = new DownloadOptimizerProviderNode(nodeId);
                this.#providerNodes.set(nodeId, p)
            }
            if (!this.#providerNodesForFiles.has(fileKey)) {
                this.#providerNodesForFiles.set(fileKey, new Set<NodeId>())
            }
            this.#providerNodesForFiles.get(fileKey)?.add(nodeId);
            this._scheduleUpdate();
        })
    }
    _scheduleUpdate() {
        if (this.#updateScheduled) return;
        this.#updateScheduled = true;
        setTimeout(() => {
            this.#updateScheduled = false;
            this._update();
        }, 1);
    }
    _update() {
        let numActiveFileDownloads = Array.from(this.#files.values()).filter(file => file.isDownloading).length;
        if (numActiveFileDownloads < this.#maxNumSimultaneousFileDownloads) {
            this.#files.forEach((file, fileKey) => {
                if (numActiveFileDownloads < this.#maxNumSimultaneousFileDownloads) {
                    const providerNodeCandidates: DownloadOptimizerProviderNode[] = []
                    this.#providerNodesForFiles.get(fileKey)?.forEach(providerNodeId => {
                        const providerNode = this.#providerNodes.get(providerNodeId)
                        if ((providerNode) && (!providerNode.hasFileDownloadJob())) {
                            providerNodeCandidates.push(providerNode);
                        }
                    })
                    const providerNode = chooseFastestProviderNode(providerNodeCandidates);
                    if (providerNode) {
                        const fileDownloadJob = this.#jobCreator.createFileDownloadJob({ fileKey: file.fileKey(), nodeId: providerNode.nodeId() }); // todo
                        file.setFileDownloadJob(fileDownloadJob);
                        providerNode.setFileDownloadJob(fileDownloadJob);
                        numActiveFileDownloads++;
                    }
                }
            })
        }
    }
}

const chooseFastestProviderNode = (providerNodeList: DownloadOptimizerProviderNode[]) => {
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