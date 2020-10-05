import { FileKey, NodeId } from "../interfaces/core"
import KacheryP2PNode, { LoadFileProgress } from "../KacheryP2PNode"

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
    createDownloader(args: {fileKey: FileKey, nodeId: NodeId}) {
        const downloader: Downloader = {
            onProgress: (callback: (progress: LoadFileProgress) => void) => {
                // todo
            },
            onError: (callback: (err: Error) => void) => {
                // todo
            },
            onFinished: (callback: () => void) => {
                // todo
            },
            cancel: () => {
                // todo
            }
        }
        return downloader
    }
}