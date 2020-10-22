import { NodeId } from '../interfaces/core'
import { FallbackUdpPacketRequestData, FallbackUdpPacketResponseData } from '../interfaces/NodeToNodeRequest'
import KacheryP2PNode from '../KacheryP2PNode'

export const handleFallbackUdpPacketRequest = async (node: KacheryP2PNode, fromNodeId: NodeId, requestData: FallbackUdpPacketRequestData): Promise<FallbackUdpPacketResponseData> => {
    let { dataBase64 } = requestData
    const packet = Buffer.from(dataBase64, 'base64')

    node.receiveFallbackUdpPacket(fromNodeId, packet)

    return {
        requestType: 'fallbackUdpPacket',
        success: true,
        errorMessage: null
    }
}