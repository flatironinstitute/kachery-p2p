import DataStreamy from "../common/DataStreamy"
import { ByteCount, byteCount, durationMsec, FileKey, NodeId } from "../interfaces/core"
import { DownloadFileDataRequestData, isDownloadFileDataResponseData } from "../interfaces/NodeToNodeRequest"
import KacheryP2PNode from "../KacheryP2PNode"

export default class DownloaderCreator {
    #node: KacheryP2PNode
    constructor(node: KacheryP2PNode) {
        this.#node = node
    }
    createDownloader(args: {fileKey: FileKey, nodeId: NodeId, fileSize: ByteCount}): DataStreamy {
        const _data: Buffer[] = []
        const ret = new DataStreamy();
        (async () => {
            const n = this.#node.remoteNodeManager().getRemoteNode(args.nodeId)
            if (!n) {
                ret._error(Error('Unexpected. Remote node not found.'))
                return
            }
            const requestData: DownloadFileDataRequestData = {
                requestType: 'downloadFileData',
                fileKey: args.fileKey,
                startByte: byteCount(0),
                endByte: null
            }
            const responseData = await n.sendRequest(requestData, {timeoutMsec: durationMsec(5000), method: 'default'})
            if (!isDownloadFileDataResponseData(responseData)) {
                ret._error(Error('Unexpected response data for downloadFileData request'))
                return
            }
            if (!responseData.success) {
                ret._error(Error('Unable to stream file data'))
                return
            }
            if (!responseData.streamId) {
                ret._error(Error('Unexpected: no stream ID'))
                return
            }
            const o: DataStreamy = await n.downloadFileData(responseData.streamId, {method: 'default'})
            o.onError(err => {
                ret._error(err)
            })
            o.onFinished(() => {
                const data = Buffer.concat(_data)
                this.#node.kacheryStorageManager().storeFile(args.fileKey.sha1, data).then(() => {
                    ret._end()
                }).catch((err: Error) => {
                    ret._error(err)
                })
                
            })
            o.onStarted((size: ByteCount) => {
                ret._start(size)
            })
            // o.cancel // todo
            o.onData((buf: Buffer) => {
                _data.push(buf)
                ret._data(buf)
            })
        })()

        return ret
    }
}