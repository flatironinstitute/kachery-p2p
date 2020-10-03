import { FileKey, NodeId } from "../interfaces/core"
import { ByteCount } from "../udp/UdpCongestionManager"

export interface FileDownloadJob {
    onProgress: (callback: (numBytes: ByteCount, totalBytes: ByteCount) => void) => void,
    onError: (callback: (err: Error) => void) => void,
    onFinished: (callback: () => void) => void
}

export default class FileDownloadJobCreator {
    createFileDownloadJob(args: {fileKey: FileKey, nodeId: NodeId}) {
        const job: FileDownloadJob = {
            onProgress: (callback: (numBytes: ByteCount, totalBytes: ByteCount) => void) => {
                // todo
            },
            onError: (callback: (err: Error) => void) => {
                // todo
            },
            onFinished: (callback: () => void) => {
                // todo
            }
        }
        return job
    }
}