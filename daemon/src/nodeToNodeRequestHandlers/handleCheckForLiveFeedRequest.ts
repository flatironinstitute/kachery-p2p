import { NodeId } from '../interfaces/core'
import { CheckForLiveFeedRequestData, CheckForLiveFeedResponseData } from '../interfaces/NodeToNodeRequest'
import KacheryP2PNode from '../KacheryP2PNode'

export const handleCheckForLiveFeedRequest = async (node: KacheryP2PNode,fromNodeId: NodeId, requestData: CheckForLiveFeedRequestData): Promise<CheckForLiveFeedResponseData> => {
    const { feedId } = requestData
    const found = await node.feedManager().hasWriteableFeed(feedId)
    return {
        requestType: 'checkForLiveFeed',
        found
    }
}
