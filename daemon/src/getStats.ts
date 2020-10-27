import { byteCount, ByteCount, ChannelName, isEqualTo, isOneOf, JSONObject, NodeId, optional, _validateObject } from "./interfaces/core";
import KacheryP2PNode from "./KacheryP2PNode";
import { RemoteNodeStats } from './RemoteNode';

export interface NodeStats {
    nodeId: NodeId,
    channelNames: ChannelName[]
    remoteNodes: RemoteNodeStats[]
    numUdpBytesSent: ByteCount
    numUdpPacketsSent: number
    numUdpBytesReceived: ByteCount
    numUdpPacketsReceived: number
    html?: string
}

export interface GetStatsOpts {
    format?: 'json' | 'html'
}
export const isGetStatsOpts = (x: any): x is GetStatsOpts => {
    return _validateObject(x, {
        format: optional(isOneOf([isEqualTo('json'), isEqualTo('html')]))
    })
}

export const getStats = (node: KacheryP2PNode, o: GetStatsOpts): NodeStats => {
    const s = node.publicUdpSocketServer()
    const ret: NodeStats = {
        nodeId: node.nodeId(),
        channelNames: node.channelNames(),
        numUdpBytesSent: s ? s.numBytesSent() : byteCount(0),
        numUdpPacketsSent: s ? s.numPacketsSent() : 0,
        numUdpBytesReceived: s ? s.numBytesReceived() : byteCount(0),
        numUdpPacketsReceived: s ? s.numPacketsReceived() : 0,
        remoteNodes: []
    }
    node.remoteNodeManager().getAllRemoteNodes().forEach(rn => {
        ret.remoteNodes.push(rn.getStats())
    })
    const format = o.format || 'json'
    if (format === 'json') {
        return ret
    }
    else if (format === 'html') {
        return {
            ...ret,
            html: createJsonViewHtml(ret as any as JSONObject)
        }
    }
    else {
        /* istanbul ignore next */
        throw Error('Unexpected')
    }
}

const createJsonViewHtml = (x: JSONObject) => {
    return `
<!DOCTYPE HTML>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>kachery-p2p node stats</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/jsonview@1.2.0/dist/jquery.jsonview.css" />
    <script type="text/javascript" src="http://code.jquery.com/jquery.min.js"></script>
    <script type="text/javascript" src="https://cdn.jsdelivr.net/npm/jsonview@1.2.0/dist/jquery.jsonview.js"></script>
    <script type="text/javascript">
    var x = \`${JSON.stringify(x)}\`
    $(function() {
        $("#json").JSONView(x, {collapsed: true, nl2br: false});
    });
    console.info(JSON.parse(x))
    </script>
</head>
<body>
    <h2>Kachery-p2p node stats</h2>
    <div id="json"></div>
</body>
</html>
`
}