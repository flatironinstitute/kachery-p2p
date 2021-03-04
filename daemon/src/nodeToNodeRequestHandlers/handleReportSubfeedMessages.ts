import { errorMessage, NodeId } from '../interfaces/core'
import { ReportNewSubfeedMessagesRequestData, ReportNewSubfeedMessagesResponseData } from '../interfaces/NodeToNodeRequest'
import KacheryP2PNode from '../KacheryP2PNode'

export const handleReportNewSubfeedMessages = async (node: KacheryP2PNode, fromNodeId: NodeId, requestData: ReportNewSubfeedMessagesRequestData): Promise<ReportNewSubfeedMessagesResponseData> => {
    const { feedId, subfeedHash, numMessages } = requestData
    try {
        // CHAIN:get_remote_messages:step(15)
        await node.feedManager().reportRemoteSubfeedNumMessages(feedId, subfeedHash, numMessages)
        return {
            requestType: 'reportNewSubfeedMessages',
            success: true,
            errorMessage: null
        }
    }
    catch(err) {
        return {
            requestType: 'reportNewSubfeedMessages',
            success: false,
            errorMessage: errorMessage(`Error reporting subfeed messages: ${err.message}`)
        }
    }
}
