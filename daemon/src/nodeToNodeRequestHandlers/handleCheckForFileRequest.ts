import { NodeId } from '../interfaces/core'
import { CheckForFileRequestData, CheckForFileResponseData } from '../interfaces/NodeToNodeRequest'
import KacheryP2PNode from '../KacheryP2PNode'

export const handleCheckForFileRequest = async (node: KacheryP2PNode, fromNodeId: NodeId, requestData: CheckForFileRequestData): Promise<CheckForFileResponseData> => {
    const { fileKey } = requestData
    const {found, size} = await node.kacheryStorageManager().findFile(fileKey)
    return {
        requestType: 'checkForFile',
        found,
        size
    }
}
