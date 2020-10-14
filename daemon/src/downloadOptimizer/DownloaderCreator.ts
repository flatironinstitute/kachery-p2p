import { FileKey, NodeId } from "../interfaces/core"
import { DownloadFileDataRequestData, isDownloadFileDataResponseData } from "../interfaces/NodeToNodeRequest"
import KacheryP2PNode, { LoadFileProgress, StreamFileDataOutput } from "../KacheryP2PNode"
import { ByteCount, byteCount, byteCountToNumber, durationMsec } from "../udp/UdpCongestionManager"

export interface Downloader {
    onStarted: (callback: () => void) => void,
    onProgress: (callback: (progress: LoadFileProgress) => void) => void,
    onError: (callback: (err: Error) => void) => void,
    onFinished: (callback: () => void) => void,
    cancel: () => void
}

export default class DownloaderCreator {
    #node: KacheryP2PNode
    constructor(node: KacheryP2PNode) {
        this.#node = node
    }
    createDownloader(args: {fileKey: FileKey, nodeId: NodeId, fileSize: ByteCount}): Downloader {
        const _data: Buffer[] = []
        let _numBytesLoaded: ByteCount = byteCount(0)
        const _onStartedCallbacks: (() => void)[] = []
        const _onFinishedCallbacks: (() => void)[] = []
        const _onErrorCallbacks: ((err: Error) => void)[] = []
        const _onProgressCallbacks: ((progress: LoadFileProgress) => void)[] = []
        const _cancel = () => {
            // todo
        }
        let _error: Error | null = null
        let completed = false
        let finished = false
        const _handleError = (err: Error) => {
            if (completed) return
            completed = true
            _error = err
            _onErrorCallbacks.forEach(cb => {cb(err)})
        }
        const _handleProgress = (progress: LoadFileProgress) => {
            if (completed) return
            _onProgressCallbacks.forEach(cb => {
                cb(progress)
            })
        }
        const downloader: Downloader = {
            onStarted: (callback: () => void) => {
                _onStartedCallbacks.push(callback)
            },
            onProgress: (callback: (progress: LoadFileProgress) => void) => {
                _onProgressCallbacks.push(callback)
            },
            onError: (callback: (err: Error) => void) => {
                if (_error) {
                    callback(_error)
                    return
                }
                _onErrorCallbacks.push(callback)
            },
            onFinished: (callback: () => void) => {
                if (finished) {
                    callback()
                }
                _onFinishedCallbacks.push(callback)
            },
            cancel: () => {
                // todo
            }
        };
        
        (async () => {
            const n = this.#node.remoteNodeManager().getRemoteNode(args.nodeId)
            if (!n) {
                _handleError(Error('Unexpected. Remote node not found.'))
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
                _handleError(Error('Unexpected response data for downloadFileData request'))
                return
            }
            if (!responseData.success) {
                _handleError(Error('Unable to stream file data'))
                return
            }
            if (!responseData.streamId) {
                _handleError(Error('Unexpected: no stream ID'))
                return
            }
            console.log(`-------------- download file data ${responseData.streamId} from: ${n.remoteNodeId().slice(0, 6)}`)
            const o: StreamFileDataOutput = await n.downloadFileData(responseData.streamId, {method: 'default'})
            o.onError(err => {
                _handleError(err)
            })
            o.onFinished(() => {
                // todo: where to put the data?
                _onFinishedCallbacks.forEach(cb => {cb()})
            })
            o.onStarted(() => {
                _onStartedCallbacks.forEach(cb => {cb()})
            })
            // o.cancel // todo
            o.onData((buf: Buffer) => {
                _data.push(buf)
                _numBytesLoaded = byteCount(byteCountToNumber(_numBytesLoaded) + buf.length)
                _handleProgress({bytesLoaded: _numBytesLoaded, bytesTotal: args.fileSize, nodeId: args.nodeId})
            })
            console.log('-------------- downloadFileData response', responseData)
            // todo
        })()

        return downloader
    }
}