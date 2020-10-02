import { Address, ChannelName, HostName, Port } from './interfaces/core';
import KacheryP2PNode from './KacheryP2PNode';
import AnnounceService from './services/AnnounceService';
import BootstrapService from './services/BootstrapService';
import DaemonApiServer from './services/DaemonApiServer';
import DiscoverService from './services/DiscoverService';
import MulticastService from './services/MulticastService';
import ProxyClientService from './services/ProxyClientService';
import PublicApiServer from './services/PublicApiServer';
import PublicUdpSocketServer from './services/PublicUdpSocketServer';
import PublicWebSocketServer from './services/PublicWebSocketServer';

const startDaemon = async (args: {
    channelNames: ChannelName[],
    configDir: string,
    verbose: number,
    hostName: HostName | null,
    daemonApiPort: Port,
    httpListenPort: Port | null,
    webSocketListenPort: Port | null,
    udpListenPort: Port | null,
    label: string,
    bootstrapAddresses: Address[] | null,
    opts: {
        noBootstrap: boolean,
        isBootstrapNode: boolean
    }
}) => {
    const {
        channelNames,
        configDir,
        verbose,
        hostName,
        daemonApiPort,
        httpListenPort,
        webSocketListenPort,
        udpListenPort,
        label,
        bootstrapAddresses,
        opts
    } = args;
    // const daemon = new Daemon({configDir, verbose, discoveryVerbose, listenHost, listenPort, udpListenPort: listenPort, label, bootstrapInfos, opts});
    const kNode = new KacheryP2PNode({
        configDir,
        verbose,
        hostName,
        httpListenPort,
        webSocketListenPort,
        label,
        bootstrapAddresses,
        channelNames,
        opts
    })

    // Start the daemon http server
    const daemonApiServer = new DaemonApiServer(kNode, { verbose });
    daemonApiServer.listen(daemonApiPort);
    console.info(`Daemon http server listening on port ${daemonApiPort}`)

    // Start the public http server
    if (httpListenPort) {
        const publicApiServer = new PublicApiServer(kNode, { verbose });
        publicApiServer.listen(httpListenPort);
        console.info(`Public http server listening on port ${httpListenPort}`)
    }

    // Start the websocket server
    if (webSocketListenPort) {
        const publicWebSocketServer = new PublicWebSocketServer(kNode, { verbose });
        await publicWebSocketServer.startListening(webSocketListenPort);
        console.info(`Websocket server listening on port ${webSocketListenPort}`)
    }

    // Start the udp socket server
    if (udpListenPort) {
        const publicUdpSocketServer = new PublicUdpSocketServer(kNode);
        await publicUdpSocketServer.startListening(udpListenPort);
        console.info(`Udp socket server listening on port ${udpListenPort}`)
    }

    // start the other services
    new AnnounceService(kNode)
    new DiscoverService(kNode)
    new BootstrapService(kNode)
    new ProxyClientService(kNode)
    new MulticastService(kNode)
}

export default startDaemon