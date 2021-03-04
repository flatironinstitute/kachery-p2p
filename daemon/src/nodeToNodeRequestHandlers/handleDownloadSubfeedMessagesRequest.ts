import { NodeId } from '../interfaces/core'
import { createStreamId, DownloadSubfeedMessagesRequestData, DownloadSubfeedMessagesResponseData } from '../interfaces/NodeToNodeRequest'
import KacheryP2PNode from '../KacheryP2PNode'

export const handleDownloadSubfeedMessagesRequest = async (node: KacheryP2PNode, fromNodeId: NodeId, requestData: DownloadSubfeedMessagesRequestData): Promise<DownloadSubfeedMessagesResponseData> => {
    const streamId = createStreamId()
    node.downloadStreamManager().set(streamId, {
        ...requestData
    })
    return {
        requestType: 'downloadSubfeedMessages',
        success: true,
        streamId,
        errorMessage: null
    }
}