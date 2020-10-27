import DataStreamy, { DataStreamyProgress } from './common/DataStreamy'
import { sha1MatchesFileKey } from './common/util'
import { byteCount, ByteCount, byteCountToNumber, ChannelName, FileKey, FileManifestChunk, isFileManifest, NodeId, scaledDurationMsec, Sha1Hash } from './interfaces/core'
import KacheryP2PNode from './KacheryP2PNode'


const loadFileAsync = async (node: KacheryP2PNode, fileKey: FileKey, opts: {fromNode: NodeId | null, fromChannel: ChannelName | null}): Promise<{found: boolean, size: ByteCount}> => {
    const r = await node.kacheryStorageManager().findFile(fileKey)
    if (r.found) {
        return r
    }
    return await new Promise<{found: boolean, size: ByteCount}>((resolve, reject) => {
        const ds = loadFile(node, fileKey, opts)
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
export const loadFile = (node: KacheryP2PNode, fileKey: FileKey, opts: {fromNode: NodeId | null, fromChannel: ChannelName | null}): DataStreamy => {
    const { fromNode, fromChannel } = opts
    const ret = new DataStreamy()
    const manifestSha1 = fileKey.manifestSha1
    if (manifestSha1) {
        (async () => {
            const manifestFileKey = {sha1: manifestSha1}
            const manifestR = await loadFileAsync(node, manifestFileKey, {fromNode, fromChannel})
            if (!manifestR.found) {
                throw Error('Unexpected... loadFileAsync should have thrown an error if not found')
            }
            const manifestDataStream = await node.kacheryStorageManager().getFileReadStream(manifestFileKey)
            const manifestJson = (await manifestDataStream.allData()).toString()
            const manifest = JSON.parse(manifestJson)
            if (!isFileManifest(manifest)) {
                console.warn(manifest)
                throw new Error('Invalid manifest file')
            }
            if (!sha1MatchesFileKey({sha1: manifest.sha1, fileKey})) {
                throw new Error(`Manifest sha1 does not match file key: ${manifest.sha1}`)
            }
            ret.producer().start(manifest.size)
            let numComplete = 0
            const chunkDataStreams: DataStreamy[] = []
            manifest.chunks.forEach((chunk: FileManifestChunk) => {
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
                const ds = loadFile(node, chunkFileKey, {fromNode: opts.fromNode, fromChannel: opts.fromChannel})
                ds.onError(err => {
                    ret.producer().error(err)
                })
                ds.onProgress((progress: DataStreamyProgress) => {
                    _updateProgressForManifestLoad()
                })
                ds.onFinished(() => {
                    numComplete ++
                    if (numComplete === manifest.chunks.length) {
                        _concatenateChunks().then(() => {
                            ret.producer().end()
                        }).catch((err: Error) => {
                            ret.producer().error(err)
                        })
                    }
                })
            })
            const _updateProgressForManifestLoad = () => {
                // this can be made more efficient - don't need to loop through all in-progress files every time
                let bytesLoaded = 0
                chunkDataStreams.forEach(ds => {
                    bytesLoaded += byteCountToNumber(ds.bytesLoaded())
                })
                ret.producer().reportBytesLoaded(byteCount(bytesLoaded))
            }
            const _concatenateChunks = async () => {
                const chunkSha1s: Sha1Hash[] = manifest.chunks.map(c => c.sha1)
                await node.kacheryStorageManager().concatenateChunksAndStoreResult(manifest.sha1, chunkSha1s)
                ret.producer().end()
            }
        })().catch((err: Error) => {
            ret.producer().error(err)
        })
    }
    else {
        let fileSize = fileKey.chunkOf ? byteCount(byteCountToNumber(fileKey.chunkOf.endByte) - byteCountToNumber(fileKey.chunkOf.startByte)) : null
        const f = node.downloadOptimizer().addFile(fileKey, fileSize)
        f.incrementNumPointers()
        f.onError(err => {
            f.decrementNumPointers()
            ret.producer().error(err)
        })
        f.onProgress((progress: DataStreamyProgress) => {
            ret.producer().reportBytesLoaded(progress.bytesLoaded)
        })
        f.onFinished(() => {
            f.decrementNumPointers()
            ret.producer().end()
        })
        if (opts.fromNode) {
            node.downloadOptimizer().setProviderNodeForFile({fileKey, nodeId: opts.fromNode})
        }
        else {
            const ff = node.findFile({fileKey, timeoutMsec: scaledDurationMsec(3000), fromChannel: opts.fromChannel})
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
    }
    // todo: handle ret.onCancel ?? -- need to think about this
    return ret
}