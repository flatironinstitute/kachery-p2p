import { TIMEOUTS } from "../common/constants";
import DataStreamy, { DataStreamyProgress } from "../common/DataStreamy";
import GarbageMap from "../common/GarbageMap";
import { randomAlphaString } from "../common/util";
import { ByteCount, FileKey, fileKeyHash, FileKeyHash, NodeId, scaledDurationMsec } from "../interfaces/core";
import KacheryP2PNode from "../KacheryP2PNode";
import createDownloader from "./createDownloader";
import DownloadOptimizerJob from "./DownloadOptimizerJob";
import DownloadOptimizerProviderNode from "./DownloadOptimizerProviderNode";

export type Downloader = {start: () => Promise<DataStreamy>, stop: () => void}

interface DownloadOptimizerTask {
    taskId: string,
    fileKey: FileKey,
    fileSize: ByteCount | null,
    progressStream: DataStreamy
}

export type FindProvidersFunction = (onFound: (providerNode: DownloadOptimizerProviderNode) => void, onFinished: () => void) => void
export type CreateDownloaderFunction = (providerNode: DownloadOptimizerProviderNode, fileSize: ByteCount | null, label: string) => Downloader

export default class DownloadOptimizer {
    #jobs = new GarbageMap<FileKeyHash, DownloadOptimizerJob>(scaledDurationMsec(60 * 1000 * 60))
    #tasks = new GarbageMap<FileKeyHash, Map<string, DownloadOptimizerTask>>(scaledDurationMsec(60 * 1000 * 60))
    #providerNodes = new GarbageMap<NodeId, DownloadOptimizerProviderNode>(scaledDurationMsec(60 * 1000 * 60))
    #maxNumSimultaneousFileDownloads = 5
    #updateScheduled = false
    #onReadyListeners = new Map<string, () => void>()
    constructor(private node: KacheryP2PNode) {
    }
    async waitForReady() {
        let numActiveFileDownloads = Array.from(this.#jobs.values()).filter(file => (file.isDownloading())).length
        if (numActiveFileDownloads < this.#maxNumSimultaneousFileDownloads) return
        return new Promise<void>((resolve) => {
            const id = randomAlphaString(10)
            this.#onReadyListeners.set(id, () => {
                // self-destruct
                this.#onReadyListeners.delete(id)
                resolve()
            })
        })
    }
    createTask(fileKey: FileKey, fileSize: ByteCount | null, label: string, opts: {fromNode: NodeId | null, numRetries: number}): DataStreamy {
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
            const findProviders: FindProvidersFunction = (onFound: (providerNode: DownloadOptimizerProviderNode) => void, onFinished: () => void) => {
                // todo: what happens if we create 2 tasks, with different opts?
                if (opts.fromNode) {
                    const pn = this._getProviderNode(opts.fromNode)
                    onFound(pn)
                }
                else {
                    const ff = this.node.findFile({fileKey, timeoutMsec: TIMEOUTS.loadFileFindFile})
                    ff.onFound(result => {
                        if (result.nodeId !== this.node.nodeId()) {
                            const pn = this._getProviderNode(result.nodeId)
                            onFound(pn)
                        }
                    })
                    ff.onFinished(() => {
                        onFinished()
                    })
                }
            }
            const createDownloader0: CreateDownloaderFunction = (providerNode: DownloadOptimizerProviderNode, fileSize: ByteCount, label: string) => {
                return createDownloader(this.node, fileKey, providerNode, fileSize, label)
            }
            j = new DownloadOptimizerJob(fileKey, fileSize, label, findProviders, createDownloader0, {numRetries: opts.numRetries})
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
    _getProviderNode(nodeId: NodeId): DownloadOptimizerProviderNode {
        let p = this.#providerNodes.get(nodeId)
        if (p) return p
        const pNew = new DownloadOptimizerProviderNode(nodeId)
        this.#providerNodes.set(nodeId, pNew)
        return pNew
    }
    // _setProviderNodeForFile(fileKey: FileKey, nodeId: NodeId) {
    //     if (!this.#providerNodes.has(nodeId)) {
    //         const p = new DownloadOptimizerProviderNode(nodeId)
    //         this.#providerNodes.set(nodeId, p)
    //     }
    //     const fkh = fileKeyHash(fileKey)
    //     let s: Set<NodeId> | null = this.#providerNodesForFiles.get(fkh) || null
    //     if (s == null) {
    //         s = new Set<NodeId>()
    //         this.#providerNodesForFiles.set(fkh, s)
    //     }
    //     s.add(nodeId)
    //     this._scheduleUpdate()
    // }
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
        // delete the complete jobs
        const keys = this.#jobs.keys()
        for (let key of keys) {
            const j = this.#jobs.get(key)
            if (!j) throw Error('Unexpected j is null in _update')
            if (j.isComplete()) {
                this.#jobs.delete(key)
            }
        }

        let numActiveFileDownloads = this.#jobs.values().filter(j => (j.isRunning())).length;
        for (let fkh of this.#jobs.keys()) {
            if (numActiveFileDownloads < this.#maxNumSimultaneousFileDownloads) {
                const job = this.#jobs.get(fkh)
                /* istanbul ignore next */
                if (!job) throw Error('Unexpected in _update')
                if ((!job.isRunning()) && (!job.isComplete())) {
                    job.start()
                    numActiveFileDownloads ++
                }
            }
        }
        if (numActiveFileDownloads < this.#maxNumSimultaneousFileDownloads) {
            this.#onReadyListeners.forEach(listener => {
                // will self-destruct
                listener()
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