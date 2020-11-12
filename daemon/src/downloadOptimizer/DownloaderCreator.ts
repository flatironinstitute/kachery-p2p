import { TIMEOUTS } from "../common/constants"
import DataStreamy from "../common/DataStreamy"
import { MockNodeDefects } from "../external/mock/MockNodeDaemon"
import { ByteCount, byteCount, byteCountToNumber, elapsedSince, FileKey, NodeId, nowTimestamp } from "../interfaces/core"
import { DownloadFileDataRequestData, isDownloadFileDataResponseData } from "../interfaces/NodeToNodeRequest"
import KacheryP2PNode from "../KacheryP2PNode"
import { DownloadFileDataMethod } from "../methodOptimizers/DownloadFileDataMethodOptimizer"

export default class DownloaderCreator {
    #node: KacheryP2PNode
    constructor(node: KacheryP2PNode, private getDefects: () => MockNodeDefects) {
        this.#node = node
    }
    createDownloader(args: {fileKey: FileKey, nodeId: NodeId, fileSize: ByteCount, label: string}): {start: () => Promise<DataStreamy>, stop: () => void} {
        let _cancelled = false
        let o: {dataStream: DataStreamy, method: DownloadFileDataMethod} | null = null
        const _start = async () => {
            const timestamp = nowTimestamp()
            const ret = new DataStreamy()
            if (_cancelled) {
                ret.producer().error(Error('Cancelled'))
                return ret
            }
            const r = await this.#node.kacheryStorageManager().findFile(args.fileKey)
            if (_cancelled) {
                ret.producer().error(Error('Cancelled'))
                return ret
            }
            if (r.found) {
                ret.producer().end()
                return ret
            }
            const _data: Buffer[] = []
            const n = this.#node.remoteNodeManager().getRemoteNode(args.nodeId)
            /* istanbul ignore next */
            if (!n) {
                throw Error('Unexpected. Remote node not found.')
            }
            let requestData: DownloadFileDataRequestData
            if (this.getDefects().badDownloadFileDataRequest) {
                requestData = {
                    requestType: 'downloadFileData',
                    fileKey: args.fileKey,
                    startByte: byteCount(10),
                    endByte: byteCount(0)
                }
            }
            else {
                requestData = {
                    requestType: 'downloadFileData',
                    fileKey: args.fileKey,
                    startByte: byteCount(0),
                    endByte: null
                }
            }
            const responseData = await n.sendRequest(requestData, {timeoutMsec: TIMEOUTS.defaultRequest, method: 'default'})
            if (_cancelled) {
                ret.producer().error(Error('Cancelled'))
                return ret
            }
            /* istanbul ignore next */
            if (!isDownloadFileDataResponseData(responseData)) {
                throw Error('Unexpected response data for downloadFileData request')
            }
            if (!responseData.success) {
                ret.producer().error(Error(`Unable to stream file data: ${responseData.errorMessage}`))
                return ret
            }
            if (!responseData.streamId) {
                throw Error('Unexpected: no stream ID')
            }        
            o = await n.downloadFileData(responseData.streamId, {method: 'default'})
            o.dataStream.onError(err => {
                if (!o) throw Error('Unexpected in onError of createDownloader')
                const bytesLoaded = ret.bytesLoaded()
                const elapsedSec = elapsedSince(timestamp) / 1000
                console.log(`Error downloading file data. Downloaded ${formatByteCount(ret.bytesLoaded())} bytes in ${elapsedSec} sec from ${args.nodeId.slice(0, 6)} using ${o.method}`)
                ret.producer().error(err)
            })
            o.dataStream.onFinished(() => {
                if (!o) throw Error('Unexpected in onFinished of createDownloader')
                const bytesLoaded = ret.bytesLoaded()
                const elapsedSec = elapsedSince(timestamp) / 1000
                const rate = (byteCountToNumber(bytesLoaded) / 1e6) / elapsedSec
                console.info(`${args.label}: Downloaded ${formatByteCount(ret.bytesLoaded())} in ${elapsedSec} sec [${rate.toFixed(3)} MiB/sec] from ${args.nodeId.slice(0, 6)} using ${o.method}`)
                const data = Buffer.concat(_data)
                this.#node.kacheryStorageManager().storeFile(args.fileKey.sha1, data).then(() => {
                    ret.producer().end()
                }).catch((err: Error) => {
                    ret.producer().error(err)
                })
                
            })
            o.dataStream.onStarted((size: ByteCount) => {
                ret.producer().start(size)
            })
            o.dataStream.onData((buf: Buffer) => {
                _data.push(buf)
                ret.producer().data(buf)
            })
            ret.producer().onCancelled(() => {
                if (!o) throw Error('Unexpected in onCancelled of createDownloader')
                o.dataStream.cancel()
            })
            return ret
        }
        const _stop = () => {
            if (o) o.dataStream.cancel()
            _cancelled = true
        }
        return {
            start: _start,
            stop: _stop
        }
    }
}

export const formatByteCount = (n: ByteCount) => {
    const a = byteCountToNumber(n)
    if (a < 10000) {
        return `${a} bytes`
    }
    else if (a < 100 * 1000) {
        return `${(a / 1000).toFixed(1)} KiB`
    }
    else if (a < 100 * 1000 * 1000) {
        return `${(a / (1000 * 1000)).toFixed(1)} MiB`
    }
    else {
        return `${(a / (1000 * 1000)).toFixed(0)} MiB`
    }
}