import { TIMEOUTS } from "../common/constants"
import DataStreamy from "../common/DataStreamy"
import { MockNodeDefects } from "../external/mock/MockNodeDaemon"
import { ByteCount, byteCount, FileKey, NodeId } from "../interfaces/core"
import { DownloadFileDataRequestData, isDownloadFileDataResponseData } from "../interfaces/NodeToNodeRequest"
import KacheryP2PNode from "../KacheryP2PNode"

export default class DownloaderCreator {
    #node: KacheryP2PNode
    constructor(node: KacheryP2PNode, private getDefects: () => MockNodeDefects) {
        this.#node = node
    }
    createDownloader(args: {fileKey: FileKey, nodeId: NodeId, fileSize: ByteCount}): {start: () => Promise<DataStreamy>} {
        const _start = async () => {
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
            /* istanbul ignore next */
            if (!isDownloadFileDataResponseData(responseData)) {
                throw Error('Unexpected response data for downloadFileData request')
            }
            const ret = new DataStreamy()
            if (!responseData.success) {
                ret.producer().error(Error(`Unable to stream file data: ${responseData.errorMessage}`))
                return ret
            }
            if (!responseData.streamId) {
                throw Error('Unexpected: no stream ID')
            }        
            const o: DataStreamy = await n.downloadFileData(responseData.streamId, {method: 'default'})
            o.onError(err => {
                ret.producer().error(err)
            })
            o.onFinished(() => {
                const data = Buffer.concat(_data)
                this.#node.kacheryStorageManager().storeFile(args.fileKey.sha1, data).then(() => {
                    ret.producer().end()
                }).catch((err: Error) => {
                    ret.producer().error(err)
                })
                
            })
            o.onStarted((size: ByteCount) => {
                ret.producer().start(size)
            })
            o.onData((buf: Buffer) => {
                _data.push(buf)
                ret.producer().data(buf)
            })
            ret.producer().onCancelled(() => {
                o.cancel()
            })
            return ret
        }
        return {
            start: _start
        }
    }
}