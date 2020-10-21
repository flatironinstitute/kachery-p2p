// import { NodeId } from "../interfaces/core"
// import { ProbeRequestData, ProbeResponseData } from "../interfaces/NodeToNodeRequest"
// import KacheryP2PNode from "../KacheryP2PNode"
// import { daemonVersion, protocolVersion } from "../protocolVersion"
// import { ApiProbeResponse } from "../services/PublicApiServer"

// const handleProbeRequest = async (node: KacheryP2PNode, fromNodeId: NodeId, requestData: ProbeRequestData): Promise<ProbeResponseData> => {
//     const probeResponse: ApiProbeResponse = {
//         success: true,
//         protocolVersion: protocolVersion(),
//         daemonVersion: daemonVersion(),
//         nodeId: node.nodeId(),
//         isBootstrapNode: node.isBootstrapNode(),
//         webSocketAddress: node.webSocketAddress(),
//         publicUdpSocketAddress: node.publicUdpSocketAddress()
//     }
//     return {
//         requestType: 'probe',
//         probeResponse
//     }
// }

export default handleProbeRequest