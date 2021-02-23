import KacheryP2PNode from "../KacheryP2PNode"
import RemoteNode from "../RemoteNode"

// don't use websocket here because that is a single-channel stream
export type DownloadFileDataMethod = 'default' | 'udp' | 'http' | 'http-proxy'

export default class DownloadFileDataMethodOptimizer {
    constructor(private node: KacheryP2PNode, private remoteNode: RemoteNode) {
    }
    determineDownloadFileDataMethod(method: DownloadFileDataMethod): DownloadFileDataMethod | null {
        const availableMethods = {
            'udp': ((this.node.publicUdpSocketServer()) && (this.remoteNode.getUdpAddressForRemoteNode())) ? true : false,
            'http': this.remoteNode.getRemoteNodeHttpAddress() ? true : false,
            'http-proxy': this.remoteNode.getRemoteNodeDataProxyNode() ? true : false
        }
        if (method === 'default') {
            if (availableMethods['http']) {
                return 'http'
            }
            else if (availableMethods['udp']) {
                return 'udp'
            }
            else if (availableMethods['http-proxy']) {
                return 'http-proxy'
            }
            else {
                return null
            }
        }
        else {
            return availableMethods[method] ? method : null
        }
    }
}