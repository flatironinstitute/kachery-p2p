import { NodeId } from '../interfaces/core'
import { CheckAliveRequestData, CheckAliveResponseData } from '../interfaces/NodeToNodeRequest'
import KacheryP2PNode from '../KacheryP2PNode'

export const handleCheckAliveRequest = async (node: KacheryP2PNode, fromNodeId: NodeId, requestData: CheckAliveRequestData): Promise<CheckAliveResponseData> => {
    return {
        requestType: 'checkAlive',
        alive: true
    }
}