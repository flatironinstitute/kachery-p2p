import DataStreamy, { DataStreamyProgress } from './common/DataStreamy'
import { sha1MatchesFileKey } from './common/util'
import { formatByteCount } from './downloadOptimizer/createDownloader'
import { byteCount, ByteCount, byteCountToNumber, ChannelName, elapsedSince, FileKey, FileManifestChunk, isFileManifest, NodeId, nowTimestamp, Sha1Hash } from './interfaces/core'
import KacheryP2PNode from './KacheryP2PNode'


const loadFileAsync = async (node: KacheryP2PNode, fileKey: FileKey, opts: {fromNode: NodeId | null, fromChannel: ChannelName | null, label: string}): Promise<{found: boolean, size: ByteCount}> => {
    const r = await node.kacheryStorageManager().findFile(fileKey)
    if (r.found) {
        return r
    }
    const ds = await loadFile(node, fileKey, opts)
    return await new Promise<{found: boolean, size: ByteCount}>((resolve, reject) => {
        ds.onError(err => {
            reject(err)
        })
        ds.onFinished(() => {
            node.kacheryStorageManager().findFile(fileKey).then((r) => {
                if (r.found) {
                    resolve(r)
                }
                else {
                    reject(Error('Unexpected - unable to findFile after loadFile reported finished.'))
                }
            }, (err: Error) => {
                reject(err)
            })
        })
    })
}

async function asyncLoop<T>(list: T[], func: (item: T, index: number) => Promise<void>, opts: {numSimultaneous: number}) {
    return new Promise((resolve, reject) => {
        let i = 0
        let numComplete = 0
        let numRunning = 0
        let error = false
        const update = () => {
            if (error) return
            if (numComplete === list.length) {
                resolve()
                return
            }
            if (numRunning < opts.numSimultaneous) {
                if (i < list.length) {
                    i ++
                    numRunning ++
                    func(list[i - 1], i - 1).then(() => {
                        numComplete ++
                        numRunning --
                        process.nextTick(update)
                    })
                    .catch((err: Error) => {
                        error = true
                        numRunning --
                        reject(err)
                    })
                }
            }
        }
        update()
    })
}

export const loadFile = async (node: KacheryP2PNode, fileKey: FileKey, opts: {fromNode: NodeId | null, fromChannel: ChannelName | null, label: string, _numRetries?: number}): Promise<DataStreamy> => {
    const { fromNode, fromChannel } = opts

    const r = await node.kacheryStorageManager().findFile(fileKey)
    if (r.found) {
        const ret = new DataStreamy()
        ret.producer().end()
        return ret
    }

    const loadFileWithManifest = async () => {
        const manifestSha1 = fileKey.manifestSha1
        if (!manifestSha1) throw Error('Unexpected')
        const entireFileTimestamp = nowTimestamp()
        const ret = new DataStreamy()
        const manifestFileKey = {sha1: manifestSha1}
        let manifestR
        try {
            manifestR = await loadFileAsync(node, manifestFileKey, {fromNode, fromChannel, label: `${opts.label} manifest`})
        }
        catch(err) {
            ret.producer().error(err)
            return ret
        }
        if (!manifestR.found) {
            throw Error('Unexpected... loadFileAsync should have thrown an error if not found')
        }
        const manifestDataStream = await node.kacheryStorageManager().getFileReadStream(manifestFileKey)
        const manifestJson = (await manifestDataStream.allData()).toString()
        const manifest = JSON.parse(manifestJson)
        if (!isFileManifest(manifest)) {
            ret.producer().error(Error('Invalid manifest file'))
            return ret
        }
        if (!sha1MatchesFileKey({sha1: manifest.sha1, fileKey})) {
            ret.producer().error(Error(`Manifest sha1 does not match file key: ${manifest.sha1}`))
            return ret
        }
        let chunkDataStreams: DataStreamy[] = []
        const _calculateTotalBytesLoaded = () => {
            let bytesLoaded = 0
            chunkDataStreams.forEach(ds => {
                bytesLoaded += byteCountToNumber(ds.bytesLoaded())
            })
            return byteCount(bytesLoaded)
        }
        const _updateProgressForManifestLoad = () => {
            // this can be made more efficient - don't need to loop through all in-progress files every time
            const bytesLoaded = _calculateTotalBytesLoaded()
            ret.producer().reportBytesLoaded(bytesLoaded)
        }
        const _concatenateChunks = async () => {
            const chunkSha1s: Sha1Hash[] = manifest.chunks.map(c => c.sha1)
            await node.kacheryStorageManager().concatenateChunksAndStoreResult(manifest.sha1, chunkSha1s)
            ret.producer().end()
        }
        const _cancelAllChunkDataStreams = () => {
            chunkDataStreams.forEach((ds) => {
                ds.cancel()
            })
            chunkDataStreams = [] // do this so we don't cancel things twice (although it would not be a big deal)
        }
        ret.onError(() => {
            // this will get called if ret is cancelled or if there is another error
            _cancelAllChunkDataStreams()
        })
        ;(async () => {
            let timer = nowTimestamp()
            // this happens after ret is returned
            ret.producer().start(manifest.size)
            let numComplete = 0
            let errored = false
            try {
                await asyncLoop<FileManifestChunk>(manifest.chunks, async (chunk: FileManifestChunk, chunkIndex: number) => {
                    if (errored) return
                    const chunkFileKey: FileKey = {
                        sha1: chunk.sha1,
                        chunkOf: {
                            fileKey: {
                                sha1: manifest.sha1
                            },
                            startByte: chunk.start,
                            endByte: chunk.end
                        }
                    }
                    console.info(`${opts.label}: Handling chunk ${chunkIndex} of ${manifest.chunks.length}`)
                    const label0 = `${opts.label} ch ${chunkIndex}`
                    const ds = await loadFile(node, chunkFileKey, {fromNode: opts.fromNode, fromChannel: opts.fromChannel, label: label0, _numRetries: 2})
                    chunkDataStreams.push(ds)
                    return new Promise((resolve, reject) => {
                        ds.onError(err => {
                            errored = true
                            reject(err)
                        })
                        ds.onProgress((progress: DataStreamyProgress) => {
                            _updateProgressForManifestLoad()
                        })
                        ds.onFinished(() => {
                            numComplete ++
                            if (numComplete === manifest.chunks.length) {
                                console.info(`${opts.label}: Concatenating chunks`)
                                _concatenateChunks().then(() => {
                                    const bytesLoaded = _calculateTotalBytesLoaded()
                                    const elapsedSec = elapsedSince(entireFileTimestamp) / 1000
                                    const rate = (byteCountToNumber(bytesLoaded) / 1e6) / elapsedSec
                                    console.info(`${opts.label}: Downloaded ${formatByteCount(bytesLoaded)} in ${elapsedSec} sec [${rate.toFixed(3)} MiB/sec]`)
                                    ret.producer().end()
                                }).catch((err: Error) => {
                                    reject(err)
                                })
                            }
                            resolve()
                        })
                    })
                }, {numSimultaneous: 5})
            }
            catch(err) {
                ret.producer().error(err)
                return
            }
        })()
        return ret
    }
    const loadFileWithoutManifest = async () => {
        let timer = nowTimestamp()
        await node.downloadOptimizer().waitForReady()
        const ret = new DataStreamy()
        let fileSize = fileKey.chunkOf ? byteCount(byteCountToNumber(fileKey.chunkOf.endByte) - byteCountToNumber(fileKey.chunkOf.startByte)) : null
        const numRetries = opts._numRetries === undefined ? 0 : opts._numRetries
        const task = node.downloadOptimizer().createTask(fileKey, fileSize, opts.label, {fromNode: opts.fromNode, fromChannel: opts.fromChannel, numRetries})
        task.onError(err => {
            ret.producer().error(err)
        })
        task.onProgress((progress: DataStreamyProgress) => {
            ret.producer().reportBytesLoaded(progress.bytesLoaded)
        })
        task.onFinished(() => {
            ret.producer().end()
        })
        ret.onError(() => {
            // this gets called on cancel or on any other error
            task.cancel() // cancel the download
        })
        return ret
    }

    if (fileKey.manifestSha1) {
        return await loadFileWithManifest()
    }
    else {
        return await loadFileWithoutManifest()
    }
}