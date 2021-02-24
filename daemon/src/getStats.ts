import { ByteCount, isEqualTo, isOneOf, JSONObject, NodeId, optional, _validateObject } from "./interfaces/core";
import KacheryP2PNode from "./KacheryP2PNode";
import { RemoteNodeStats } from './RemoteNode';
import { JoinedChannelConfig } from "./services/ConfigUpdateService";

export interface NodeStatsInterface {
    nodeId: NodeId,
    joinedChannels: JoinedChannelConfig[]
    remoteNodes: RemoteNodeStats[]
    totalBytesSent: {
        total: ByteCount,
        multicastUdp: ByteCount,
        udp: ByteCount,
        http: ByteCount,
        webSocket: ByteCount
    },
    totalBytesReceived: {
        total: ByteCount,
        multicastUdp: ByteCount,
        udp: ByteCount,
        http: ByteCount,
        webSocket: ByteCount
    },
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

export const getStats = (node: KacheryP2PNode, o: GetStatsOpts): NodeStatsInterface => {
    const s = node.publicUdpSocketServer()
    const ret: NodeStatsInterface = {
        nodeId: node.nodeId(),
        joinedChannels: node.joinedChannels(),
        totalBytesSent: node.stats().totalBytesSent(),
        totalBytesReceived: node.stats().totalBytesReceived(),
        remoteNodes: []
    }
    node.remoteNodeManager().getAllRemoteNodes({includeOffline: true}).forEach(rn => {
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
        throw Error('Unexpected in getStats')
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