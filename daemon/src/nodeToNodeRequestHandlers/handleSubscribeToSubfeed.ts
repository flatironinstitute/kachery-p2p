import { errorMessage, NodeId } from '../interfaces/core'
import { SubscribeToSubfeedRequestData, SubscribeToSubfeedResponseData } from '../interfaces/NodeToNodeRequest'
import KacheryP2PNode from '../KacheryP2PNode'

export const handleSubscribeToSubfeed = async (node: KacheryP2PNode, fromNodeId: NodeId, requestData: SubscribeToSubfeedRequestData): Promise<SubscribeToSubfeedResponseData> => {
    // CHAIN:get_remote_messages:step(8)
    const { feedId, subfeedHash } = requestData
    if (!node.feedManager().hasWriteableFeed(feedId)) {
        return {
            requestType: 'subscribeToSubfeed',
            success: false,
            numMessages: null,
            errorMessage: errorMessage(`Does not have writeable feed: ${feedId.slice(0, 10)}`)
        }
    }
    try {
        // CHAIN:get_remote_messages:step(9)
        const numMessages = await node.feedManager().renewIncomingSubfeedSubscription(fromNodeId, feedId, subfeedHash)
        return {
            requestType: 'subscribeToSubfeed',
            success: true,
            numMessages,
            errorMessage: null
        }
    }
    catch(err) {
        return {
            requestType: 'subscribeToSubfeed',
            success: false,
            numMessages: null,
            errorMessage: errorMessage(`Error renewing subfeed subscription: ${err.message}`)
        }
    }
    
}
