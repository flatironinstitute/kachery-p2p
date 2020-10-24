import { errorMessage, NodeId, submittedSubfeedMessageToSubfeedMessage } from '../interfaces/core'
import { SubmitMessageToLiveFeedRequestData, SubmitMessageToLiveFeedResponseData } from '../interfaces/NodeToNodeRequest'
import KacheryP2PNode from '../KacheryP2PNode'

export const handleSubmitMessageToLiveFeedRequest = async (node: KacheryP2PNode, fromNodeId: NodeId, requestData: SubmitMessageToLiveFeedRequestData): Promise<SubmitMessageToLiveFeedResponseData> => {
    const { feedId, subfeedHash, message } = requestData
    const hasWriteable = await node.feedManager().hasWriteableFeed({feedId})
    if (!hasWriteable) {
        return {
            requestType: 'submitMessageToLiveFeed',
            success: false,
            errorMessage: errorMessage('Node does not have writeable feed with that ID')
        }
    }
    const rules = await node.feedManager().getAccessRules({feedId, subfeedHash})
    if ((rules === null) || (rules.rules.filter(r => ((r.nodeId === fromNodeId) && (r.write))).length === 0)) {
        return {
            requestType: 'submitMessageToLiveFeed',
            success: false,
            errorMessage: errorMessage('Permission denied')
        }
    }
    try {
        await node.feedManager().appendMessages({feedId, subfeedHash, messages: [submittedSubfeedMessageToSubfeedMessage(message)]})
    }
    catch(err) {
        /* istanbul ignore next */
        return {
            requestType: 'submitMessageToLiveFeed',
            success: false,
            errorMessage: errorMessage('Error appending message')
        }
    }
    return {
        requestType: 'submitMessageToLiveFeed',
        success: true,
        errorMessage: null
    }
}