import { errorMessage, NodeId } from '../interfaces/core'
import { ReportSubfeedMessagesRequestData, ReportSubfeedMessagesResponseData } from '../interfaces/NodeToNodeRequest'
import KacheryP2PNode from '../KacheryP2PNode'

export const handleReportSubfeedMessages = async (node: KacheryP2PNode, fromNodeId: NodeId, requestData: ReportSubfeedMessagesRequestData): Promise<ReportSubfeedMessagesResponseData> => {
    const { feedId, subfeedHash, position, signedMessages } = requestData
    try {
        // CHAIN:get_remote_messages:step(15)
        console.log('-------------------- S15')
        await node.feedManager().reportRemoteSubfeedMessages(feedId, subfeedHash, position, signedMessages)
        return {
            requestType: 'reportSubfeedMessages',
            success: true,
            errorMessage: null
        }
    }
    catch(err) {
        return {
            requestType: 'reportSubfeedMessages',
            success: false,
            errorMessage: errorMessage(`Error reporting subfeed messages: ${err.message}`)
        }
    }
}
