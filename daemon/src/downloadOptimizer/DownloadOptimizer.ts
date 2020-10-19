import DataStreamy from "../common/DataStreamy";
import { ByteCount, FileKey, NodeId } from "../interfaces/core";
import DownloadOptimizerJob from "./DownloadOptimizerJob";
import DownloadOptimizerProviderNode from "./DownloadOptimizerProviderNode";

interface DownloaderCreatorInterface {
    createDownloader: (args: {fileKey: FileKey, nodeId: NodeId}) => DataStreamy
}

export default class DownloadOptimizer {
    #jobs = new Map<FileKey, DownloadOptimizerJob>()
    #providerNodes = new Map<NodeId, DownloadOptimizerProviderNode>()
    #providerNodesForFiles = new Map<FileKey, Set<NodeId>>()
    #downloaderCreator: DownloaderCreatorInterface
    #maxNumSimultaneousFileDownloads = 5
    #updateScheduled = false
    constructor(downloaderCreator: DownloaderCreatorInterface) {
        this.#downloaderCreator = downloaderCreator
    }
    addFile(fileKey: FileKey, fileSize: ByteCount | null): DownloadOptimizerJob {
        let j = this.#jobs.get(fileKey)
        if (!j) {
            j = new DownloadOptimizerJob(fileKey, fileSize)
            this.#jobs.set(fileKey, j)
        }
        j.onError(() => {
            this.#jobs.delete(fileKey)
            this._scheduleUpdate()
        });
        j.onFinished(() => {
            this.#jobs.delete(fileKey)
            this._scheduleUpdate()
        });
        this._scheduleUpdate()
        return j
    }
    setProviderNodeForFile({ fileKey, nodeId }: {fileKey: FileKey, nodeId: NodeId}) {
        if (!this.#providerNodes.has(nodeId)) {
            const p = new DownloadOptimizerProviderNode(nodeId)
            this.#providerNodes.set(nodeId, p)
        }
        let s: Set<NodeId> | null = this.#providerNodesForFiles.get(fileKey) || null
        if (s == null) {
            s = new Set<NodeId>()
            this.#providerNodesForFiles.set(fileKey, s)
        }
        s.add(nodeId)
        this._scheduleUpdate()
    }
    _scheduleUpdate() {
        if (this.#updateScheduled) return
        this.#updateScheduled = true
        setTimeout(() => {
            this.#updateScheduled = false
            this._update()
        }, 1);
    }
    _update() {
        let numActiveFileDownloads = Array.from(this.#jobs.values()).filter(file => (file.isDownloading())).length;
        if (numActiveFileDownloads < this.#maxNumSimultaneousFileDownloads) {
            this.#jobs.forEach((job, fileKey) => {
                if (numActiveFileDownloads < this.#maxNumSimultaneousFileDownloads) {
                    if ((!job.isDownloading()) && (job.numPointers() > 0)) {
                        const providerNodeCandidates: DownloadOptimizerProviderNode[] = []
                        let providerNodeIds = this.#providerNodesForFiles.get(fileKey)
                        if (providerNodeIds) {
                            providerNodeIds.forEach(providerNodeId => {
                                const providerNode = this.#providerNodes.get(providerNodeId)
                                if ((providerNode) && (!providerNode.isDownloading())) {
                                    providerNodeCandidates.push(providerNode);
                                }
                            })
                        }
                        const providerNode = chooseFastestProviderNode(providerNodeCandidates);
                        if (providerNode) {
                            const downloader = this.#downloaderCreator.createDownloader({ fileKey: job.fileKey(), nodeId: providerNode.nodeId() });
                            job.setDownloader(downloader)
                            providerNode.setDownloader(downloader)
                            numActiveFileDownloads++;
                        }
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
    const estimatedRates = providerNodeList.map(p => p.estimatedRateBps()).map(x => Number(x));
    const bestIndex = argMax(estimatedRates);
    return providerNodeList[bestIndex];
}


// thanks: https://gist.github.com/engelen/fbce4476c9e68c52ff7e5c2da5c24a28
function argMax(array: number[]) {
    return array.map((x, i) => [x, i]).reduce((r, a) => (a[0] > r[0] ? a : r))[1];
}