import { errorMessage, NodeId } from '../interfaces/core'
import { GetLiveFeedSignedMessagesRequestData, GetLiveFeedSignedMessagesResponseData } from '../interfaces/NodeToNodeRequest'
import KacheryP2PNode from '../KacheryP2PNode'

export const handleGetLiveFeedSignedMessagesRequest = async (node: KacheryP2PNode, fromNodeId: NodeId, requestData: GetLiveFeedSignedMessagesRequestData): Promise<GetLiveFeedSignedMessagesResponseData> => {
    const { feedId, subfeedHash, position, maxNumMessages, waitMsec } = requestData
    const hasLiveFeed = await node.feedManager().hasWriteableFeed(feedId)
    if (!hasLiveFeed) {
        return {
            requestType: 'getLiveFeedSignedMessages',
            success: false,
            errorMessage: errorMessage(`Live feed not found.`),
            signedMessages: null
        }
    }
    const signedMessages = await node.feedManager().getSignedMessages({feedId, subfeedHash, position, maxNumMessages, waitMsec})
    return {
        requestType: 'getLiveFeedSignedMessages',
        success: true,
        errorMessage: null,
        signedMessages
    }
}