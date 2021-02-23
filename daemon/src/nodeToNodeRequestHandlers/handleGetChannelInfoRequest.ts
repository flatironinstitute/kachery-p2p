import { NodeId } from '../interfaces/core'
import { GetChannelInfoRequestData, GetChannelInfoResponseData } from '../interfaces/NodeToNodeRequest'
import KacheryP2PNode from '../KacheryP2PNode'


export const handleGetChannelInfoRequest = async (node: KacheryP2PNode, fromNodeId: NodeId, requestData: GetChannelInfoRequestData): Promise<GetChannelInfoResponseData> => {
    const { channelConfigUrl } = requestData
    const channelInfo = await node.remoteNodeManager().getChannelInfo(channelConfigUrl)
    return {
        requestType: 'getChannelInfo',
        channelInfo
    }
}