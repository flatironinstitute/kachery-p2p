import { errorMessage, NodeId } from '../interfaces/core'
import { StartStreamViaUdpRequestData, StartStreamViaUdpResponseData } from '../interfaces/NodeToNodeRequest'
import KacheryP2PNode from '../KacheryP2PNode'

export const handleStartStreamViaUdpRequest = async (node: KacheryP2PNode, fromNodeId: NodeId, requestData: StartStreamViaUdpRequestData): Promise<StartStreamViaUdpResponseData> => {
    let { streamId } = requestData
    const rn = node.remoteNodeManager().getRemoteNode(fromNodeId)
    if (!rn) {
        return {
            requestType: 'startStreamViaUdp',
            success: false,
            errorMessage: errorMessage('Unable to find remote node')
        }
    }
    if (!rn.getUdpAddressForRemoteNode()) {
        return {
            requestType: 'startStreamViaUdp',
            success: false,
            errorMessage: errorMessage('Cannot stream via udp when we do not have a udp address for the remote node')
        }    
    }
    try {
        await rn.startStreamViaUdpToRemoteNode(streamId)
    }
    catch(err) {
        return {
            requestType: 'startStreamViaUdp',
            success: false,
            errorMessage: errorMessage(err.message)
        }
    }
    return {
        requestType: 'startStreamViaUdp',
        success: true,
        errorMessage: null
    }
}