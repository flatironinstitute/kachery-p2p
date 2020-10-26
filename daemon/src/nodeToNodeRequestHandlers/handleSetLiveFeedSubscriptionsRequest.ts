import { NodeId } from '../interfaces/core'
import { SetLiveFeedSubscriptionsRequestData, SetLiveFeedSubscriptionsResponseData } from '../interfaces/NodeToNodeRequest'
import KacheryP2PNode from '../KacheryP2PNode'

// not used right now
/* istanbul ignore next */
export const handleSetLiveFeedSubscriptionsRequest = async (node: KacheryP2PNode, fromNodeId: NodeId, requestData: SetLiveFeedSubscriptionsRequestData): Promise<SetLiveFeedSubscriptionsResponseData> => {
    const { liveFeedSubscriptions } = requestData
    await node.liveFeedSubscriptionManager().setSubscriptions({nodeId: fromNodeId, subscriptions: liveFeedSubscriptions})
    return {
        requestType: 'setLiveFeedSubscriptions',
        success: true
    }
}