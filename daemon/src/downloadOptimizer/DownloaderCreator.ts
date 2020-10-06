import { FileKey, NodeId } from "../interfaces/core"
import { DownloadFileDataRequestData } from "../interfaces/NodeToNodeRequest"
import KacheryP2PNode, { LoadFileProgress } from "../KacheryP2PNode"
import { ByteCount, byteCount } from "../udp/UdpCongestionManager"

export interface Downloader {
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
    createDownloader(args: {fileKey: FileKey, nodeId: NodeId}): Downloader {
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
        const downloader: Downloader = {
            onProgress: (callback: (progress: LoadFileProgress) => void) => {
                // todo
            },
            onError: (callback: (err: Error) => void) => {
                if (_error) {
                    callback(_error)
                    return
                }
            },
            onFinished: (callback: () => void) => {
                if (finished) {
                    callback()
                    return
                }
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
            const fileSize: ByteCount | null = n.getFileSizeForFileKey(args.fileKey)
            if (fileSize === null) {
                _handleError(Error('Unexpected. Remote node does not know size of file'))
                return
            }
            const requestData: DownloadFileDataRequestData = {
                requestType: 'downloadFileData',
                fileKey: args.fileKey,
                startByte: byteCount(0),
                endByte: fileSize
            }
            const responseData = await n.sendRequest(requestData, {timeoutMsec: 5000, method: 'default'})
            // todo
        })()

        return downloader
    }
}