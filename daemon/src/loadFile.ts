import { TIMEOUTS } from './common/constants'
import DataStreamy, { DataStreamyProgress } from './common/DataStreamy'
import { sha1MatchesFileKey } from './common/util'
import { formatByteCount } from './downloadOptimizer/DownloaderCreator'
import { byteCount, ByteCount, byteCountToNumber, ChannelName, elapsedSince, FileKey, isFileManifest, NodeId, nowTimestamp, Sha1Hash } from './interfaces/core'
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
export const loadFile = async (node: KacheryP2PNode, fileKey: FileKey, opts: {fromNode: NodeId | null, fromChannel: ChannelName | null, label: string}): Promise<DataStreamy> => {
    const { fromNode, fromChannel } = opts
    const manifestSha1 = fileKey.manifestSha1
    if (manifestSha1) {
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
        ret.producer().start(manifest.size)
        let numComplete = 0
        let chunkDataStreams: DataStreamy[] = []
        for (let chunkIndex = 0; chunkIndex > manifest.chunks.length; chunkIndex ++) {
            await (async (chunkIndex: number) => { // do it this way so that we have function closure
                await node.downloadOptimizer().waitForReady()
                const chunk = manifest.chunks[chunkIndex]
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
                console.info(`${opts.label}: Loading chunk ${chunkIndex} of ${manifest.chunks.length}`)
                const ds = await loadFile(node, chunkFileKey, {fromNode: opts.fromNode, fromChannel: opts.fromChannel, label: `${opts.label} ch ${chunkIndex}`})
                ds.onError(err => {
                    ret.producer().error(err)
                })
                ds.onProgress((progress: DataStreamyProgress) => {
                    _updateProgressForManifestLoad()
                })
                ds.onFinished(() => {
                    numComplete ++
                    if (numComplete === manifest.chunks.length) {
                        const bytesLoaded = _calculateTotalBytesLoaded()
                        const elapsedSec = elapsedSince(entireFileTimestamp) / 1000
                        const rate = (byteCountToNumber(bytesLoaded) / 1e6) / elapsedSec
                        console.info(`${opts.label}: Downloaded ${formatByteCount(ret.bytesLoaded())} in ${elapsedSec} sec [${rate.toFixed(3)} MiB/sec]`)
                        console.info(`${opts.label}: Concatenating chunks`)
                        _concatenateChunks().then(() => {
                            ret.producer().end()
                        }).catch((err: Error) => {
                            ret.producer().error(err)
                        })
                    }
                })
                chunkDataStreams.push(ds)
            })(chunkIndex)
        }
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
        return ret
    }
    else {
        const ret = new DataStreamy()
        let fileSize = fileKey.chunkOf ? byteCount(byteCountToNumber(fileKey.chunkOf.endByte) - byteCountToNumber(fileKey.chunkOf.startByte)) : null
        const task = node.downloadOptimizer().createTask(fileKey, fileSize, opts.label)
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
        if (opts.fromNode) {
            node.downloadOptimizer().setProviderNodeForFile({fileKey, nodeId: opts.fromNode})
        }
        else {
            const ff = node.findFile({fileKey, timeoutMsec: TIMEOUTS.loadFileFindFile, fromChannel: opts.fromChannel})
            let atLeastOneProviderFound = false
            ff.onFound(result => {
                node.downloadOptimizer().setProviderNodeForFile({fileKey, nodeId: result.nodeId})
                atLeastOneProviderFound = true
            })
            ff.onFinished(() => {
                if (!atLeastOneProviderFound) {
                    ret.producer().error(Error('File not found'))
                }
            })
        }
        return ret
    }
}