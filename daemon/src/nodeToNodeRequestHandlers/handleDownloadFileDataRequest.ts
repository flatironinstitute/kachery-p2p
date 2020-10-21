import { byteCount, byteCountToNumber, errorMessage, NodeId } from '../interfaces/core'
import { createStreamId, DownloadFileDataRequestData, DownloadFileDataResponseData } from '../interfaces/NodeToNodeRequest'
import KacheryP2PNode from '../KacheryP2PNode'

export const handleDownloadFileDataRequest = async (node: KacheryP2PNode, fromNodeId: NodeId, requestData: DownloadFileDataRequestData): Promise<DownloadFileDataResponseData> => {
    let { fileKey, startByte, endByte } = requestData
    if ((byteCountToNumber(startByte) < 0) || ((endByte !== null) && (byteCountToNumber(startByte) >= byteCountToNumber(endByte)))) {
        return {
            requestType: 'downloadFileData',
            fileKey,
            startByte,
            endByte: endByte === null ? byteCount(0): endByte,
            success: false,
            streamId: null,
            errorMessage: errorMessage('Invalid start/end bytes')
        }
    }
    const {found, size} = await node.kacheryStorageManager().findFile(fileKey)
    if (!found) {
        return {
            requestType: 'downloadFileData',
            fileKey,
            startByte,
            endByte: endByte === null ? byteCount(0): endByte,
            success: false,
            streamId: null,
            errorMessage: errorMessage('Unable to find file')
        }
    }
    if (size === null) {
        throw Error('Unexpected')
    }
    if (endByte === null) {
        endByte = size
    }
    if (endByte > size) {
        return {
            requestType: 'downloadFileData',
            fileKey,
            startByte,
            endByte: endByte === null ? byteCount(0): endByte,
            success: false,
            streamId: null,
            errorMessage: errorMessage('Start/end bytes out of range')
        }
    }
    const streamId = createStreamId()
    node.downloadStreamManager().set(streamId, {
        ...requestData,
        endByte
    })
    return {
        requestType: 'downloadFileData',
        fileKey,
        startByte,
        endByte,
        success: true,
        streamId,
        errorMessage: null
    }
}