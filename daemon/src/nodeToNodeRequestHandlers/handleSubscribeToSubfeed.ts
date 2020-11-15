import { ChannelName, errorMessage, NodeId } from '../interfaces/core'
import { SubscribeToSubfeedRequestData, SubscribeToSubfeedResponseData } from '../interfaces/NodeToNodeRequest'
import KacheryP2PNode from '../KacheryP2PNode'

export const handleSubscribeToSubfeed = async (node: KacheryP2PNode, fromNodeId: NodeId, channelName: ChannelName, requestData: SubscribeToSubfeedRequestData): Promise<SubscribeToSubfeedResponseData> => {
    const { feedId, subfeedHash, position, durationMsec } = requestData
    if (!node.feedManager().hasWriteableFeed(feedId)) {
        return {
            requestType: 'subscribeToSubfeed',
            success: false,
            initialSignedMessages: null,
            errorMessage: errorMessage(`Does not have writeable feed: ${feedId.slice(0, 10)}`)
        }
    }
    try {
        const initialSignedMessages = await node.feedManager().renewIncomingSubfeedSubscription(fromNodeId, channelName, feedId, subfeedHash, position, durationMsec)
        return {
            requestType: 'subscribeToSubfeed',
            success: true,
            initialSignedMessages,
            errorMessage: null
        }
    }
    catch(err) {
        return {
            requestType: 'subscribeToSubfeed',
            success: false,
            initialSignedMessages: null,
            errorMessage: errorMessage(`Error renewing subfeed subscription: ${err.message}`)
        }
    }
    
}
