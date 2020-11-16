import DataStreamy, { DataStreamyProgress } from "../common/DataStreamy";
import GarbageMap from "../common/GarbageMap";
import { ByteCount, byteCount, durationMsecToNumber, elapsedSince, FileKey, NodeId, nowTimestamp, scaledDurationMsec } from "../interfaces/core";
import { CreateDownloaderFunction, Downloader, FindProvidersFunction } from "./DownloadOptimizer";
import DownloadOptimizerProviderNode from "./DownloadOptimizerProviderNode";

export default class DownloadOptimizerJob {
    #currentDownloader: {start: () => Promise<DataStreamy>, stop: () => void} | null = null
    #bytesLoaded = byteCount(0)
    #progressStream: DataStreamy = new DataStreamy()
    #isRunning = false
    #isComplete = false
    constructor(private fileKey_: FileKey, private fileSize_: ByteCount | null, private label_: string, private findProviders: FindProvidersFunction, private createDownloader: CreateDownloaderFunction, private opts: {numRetries: number}) {
    }
    fileKey() {
        return this.fileKey_
    }
    fileSize() {
        return this.fileSize_
    }
    label() {
        return this.label_
    }
    isDownloading() {
        return this.#currentDownloader ? true : false;
    }
    bytesLoaded() {
        return this.#bytesLoaded
    }
    cancel() {
        if (this.#currentDownloader) {
            this.#currentDownloader.stop()
        }
    }
    isRunning() {
        return this.#isRunning
    }
    isComplete() {
        return this.#isComplete
    }
    start() {
        this.#isRunning = true
        const timestamp = nowTimestamp()
        let numRemainingRetries = this.opts.numRetries

        const nextTry = () => {
            let findFinished = false
            let providerCandidates = new GarbageMap<NodeId, DownloadOptimizerProviderNode>(scaledDurationMsec(60 * 60 * 1000))
            let currentDownloader: Downloader | null = null
            let lastDownloaderError: Error | null = null
            let somethingFound = false
            let complete = false
            const onFound = (providerNode: DownloadOptimizerProviderNode) => {
                if (complete) return
                somethingFound = true
                providerCandidates.set(providerNode.nodeId(), providerNode)
                update()
            }
            const onFindFinished = () => {
                if (complete) return
                findFinished = true
                update()
            }
            const returnError = (err: Error) => {
                if (complete) return
                complete = true
                if ((numRemainingRetries <= 0) || (!somethingFound)) {
                    this.#isComplete = true
                    this.#isRunning = false
                    this.#progressStream.producer().error(err)
                }
                else {
                    console.info('Retrying download')
                    numRemainingRetries --
                    setTimeout(() => {
                        nextTry()
                    }, durationMsecToNumber(scaledDurationMsec(2000)))
                }
            }
            const returnFinished = () => {
                if (complete) return
                complete = true
                this.#isComplete = true
                this.#isRunning = false
                this.#progressStream.producer().end()
            }
            const handleErrorInCurrentDownloader = (err: Error) => {
                if (!currentDownloader) return
                currentDownloader = null
                lastDownloaderError = err
                update()
            }
            const update = () => {
                if (complete) return
                // check if we are currently downloading something
                if (currentDownloader) return

                if (providerCandidates.values().length > 0) {
                    // we have at least one provider node... however, we might get some more so let's see if we should wait a bit more
                    const elapsed = elapsedSince(timestamp)
                    if ((!findFinished) && (elapsed < 500)) {
                        // come back in a bit
                        setTimeout(() => {
                            update()
                        }, durationMsecToNumber(scaledDurationMsec(600)))
                        return
                    }
                    // choose the best non-busy provider node
                    const nonBusyCandidates = providerCandidates.values().filter(pn => (!pn.isDownloading()))
                    if (nonBusyCandidates.length === 0) {
                        // they are all busy, come back in a second
                        setTimeout(() => {
                            update()
                        }, durationMsecToNumber(scaledDurationMsec(1000)))
                        return
                    }
                    const pn = chooseFastestProviderNode(nonBusyCandidates)
                    if (!pn) throw Error('Unexpected, pn is null in update')
                    providerCandidates.delete(pn.nodeId())
                    currentDownloader = this.createDownloader(pn, this.fileSize(), this.label())
                    currentDownloader.start().then((ds: DataStreamy) => {
                        ds.onError((err: Error) => {
                            // error downloading
                            handleErrorInCurrentDownloader(err)
                        })
                        ds.onFinished(() => {
                            // we finished downloading!
                            returnFinished()
                        })
                        ds.onProgress((progress: DataStreamyProgress) => {
                            this.#progressStream.producer().setProgress(progress)
                        })
                    }).catch(err => {
                        // error starting the downloader
                        handleErrorInCurrentDownloader(err)
                    })
                }
                else {
                    // no provider candidates yet
                    if (findFinished) {
                        // we have finished finding, so we'll return an error
                        if (lastDownloaderError) {
                            returnError(lastDownloaderError)
                        }
                        else {
                            if (!somethingFound) {
                                returnError(Error('File not found'))
                            }
                            else {
                                returnError(Error('Problem in download'))
                            }
                        }
                        return
                    }
                    else {
                        // we'll wait until update is called again
                    }
                }
            }
            this.findProviders(onFound, onFindFinished)
        }
        nextTry()
    }
    // setDownloader(downloader: {start: () => Promise<DataStreamy>, stop: () => void}) {
    //     if (this.#currentDownloader !== null) {
    //         /* istanbul ignore next */
    //         throw Error('Unexpected: job already has a downloader')
    //     }
    //     this.#currentDownloader = downloader
    //     downloader.start().then((ds) => {
    //         ds.onStarted((size: ByteCount | null) => {
    //             this.#progressStream.producer().start(size)
    //         })
    //         ds.onProgress((progress: DataStreamyProgress) => {
    //             this.#bytesLoaded = progress.bytesLoaded
    //             this.#progressStream.producer().setProgress(progress)
    //         });
    //         const _handleComplete = () => {
    //             this.#currentDownloader = null
    //         }
    //         ds.onError((err: Error) => {
    //             _handleComplete();
    //             this.#progressStream.producer().error(err)
    //         });
    //         ds.onFinished(() => {
    //             _handleComplete();
    //             this.#progressStream.producer().end()
    //         });
    //     }).catch((err) => {
    //         throw Error(`Error starting downloader: ${err.message}`)
    //     })
    // }
    getProgressStream() {
        return this.#progressStream
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