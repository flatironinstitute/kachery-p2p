import DataStreamy, { DataStreamyProgress } from "../common/DataStreamy";
import { randomAlphaString } from "../common/util";
import { ByteCount, FileKey, fileKeyHash, FileKeyHash, NodeId } from "../interfaces/core";
import DownloadOptimizerJob from "./DownloadOptimizerJob";
import DownloadOptimizerProviderNode from "./DownloadOptimizerProviderNode";

interface DownloaderCreatorInterface {
    createDownloader: (args: {fileKey: FileKey, nodeId: NodeId}) => {start: () => Promise<DataStreamy>, stop: () => void}
}

interface DownloadOptimizerTask {
    taskId: string,
    fileKey: FileKey,
    fileSize: ByteCount | null,
    progressStream: DataStreamy
}

export default class DownloadOptimizer {
    #jobs = new Map<FileKeyHash, DownloadOptimizerJob>()
    #tasks = new Map<FileKeyHash, Map<string, DownloadOptimizerTask>>()
    #providerNodes = new Map<NodeId, DownloadOptimizerProviderNode>()
    #providerNodesForFiles = new Map<FileKeyHash, Set<NodeId>>()
    #downloaderCreator: DownloaderCreatorInterface
    #maxNumSimultaneousFileDownloads = 5
    #updateScheduled = false
    constructor(downloaderCreator: DownloaderCreatorInterface) {
        this.#downloaderCreator = downloaderCreator
    }
    createTask(fileKey: FileKey, fileSize: ByteCount | null): DataStreamy {
        const taskId = randomAlphaString(10)
        const fkh = fileKeyHash(fileKey)
        const t: DownloadOptimizerTask = {
            taskId,
            fileKey,
            fileSize,
            progressStream: new DataStreamy()
        }
        let j = this.#jobs.get(fkh)
        if (!j) {
            j = new DownloadOptimizerJob(fileKey, fileSize)
            this.#jobs.set(fkh, j)
        }
        j.getProgressStream().onStarted((byteCount: ByteCount) => {
            t.progressStream.producer().start(byteCount)
        })
        j.getProgressStream().onProgress((progress: DataStreamyProgress) => {
            t.progressStream.producer().setProgress(progress)
        })
        j.getProgressStream().onError((err: Error) => {
            t.progressStream.producer().error(err)
            this._deleteTask(fkh, taskId)
        })
        j.getProgressStream().onFinished(() => {
            t.progressStream.producer().end()
            this._deleteTask(fkh, taskId)
        })
        t.progressStream.producer().onCancelled(() => {
            this._deleteTask(fkh, taskId)
        })
        let tasks0 = this.#tasks.get(fkh)
        if (!tasks0) {
            tasks0 = new Map<string, DownloadOptimizerTask>()
            this.#tasks.set(fkh, tasks0)
        }
        tasks0.set(t.taskId, t)
        this._scheduleUpdate()
        return t.progressStream
    }
    _deleteTask(fileKeyHash: FileKeyHash, taskId: string) {
        const tasks = this.#tasks.get(fileKeyHash)
        if (!tasks) return
        const t = tasks.get(taskId)
        if (!t) return
        tasks.delete(taskId)
        if (tasks.size === 0) {
            const j = this.#jobs.get(fileKeyHash)
            if (j) {
                j.cancel()
                this.#jobs.delete(fileKeyHash)
            }
        }
        this._scheduleUpdate()
    }
    setProviderNodeForFile({ fileKey, nodeId }: {fileKey: FileKey, nodeId: NodeId}) {
        if (!this.#providerNodes.has(nodeId)) {
            const p = new DownloadOptimizerProviderNode(nodeId)
            this.#providerNodes.set(nodeId, p)
        }
        const fkh = fileKeyHash(fileKey)
        let s: Set<NodeId> | null = this.#providerNodesForFiles.get(fkh) || null
        if (s == null) {
            s = new Set<NodeId>()
            this.#providerNodesForFiles.set(fkh, s)
        }
        s.add(nodeId)
        this._scheduleUpdate()
    }
    _scheduleUpdate() {
        if (this.#updateScheduled) return
        this.#updateScheduled = true
        setTimeout(() => {
            this.#updateScheduled = false
            this._update().then(() => {
            }).catch((err: Error) => {
                console.error(`Unexpected error updating download optimizer: ${err.message}`)
            })
        }, 1);
    }
    async _update() {
        let numActiveFileDownloads = Array.from(this.#jobs.values()).filter(file => (file.isDownloading())).length;
        if (numActiveFileDownloads < this.#maxNumSimultaneousFileDownloads) {
            for (let fkh of this.#jobs.keys()) {
                const job = this.#jobs.get(fkh)
                /* istanbul ignore next */
                if (!job) throw Error('Unexpected')
                if (numActiveFileDownloads < this.#maxNumSimultaneousFileDownloads) {
                    if (!job.isDownloading()) {
                        const providerNodeCandidates: DownloadOptimizerProviderNode[] = []
                        let providerNodeIds = this.#providerNodesForFiles.get(fkh)
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
                            // todo: why would this be called 8 times?
                            job.setDownloader(downloader)
                            providerNode.setDownloaderProgress(job.getProgressStream())
                            numActiveFileDownloads++;
                        }
                    }
                }
            }
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