import { UrlPath } from './common/httpPostJson';
import { Address, ChannelName, HostName, JSONObject, Port } from './interfaces/core';
import KacheryP2PNode, { DgramCreateSocketFunction } from './KacheryP2PNode';
import { LocalFilePath } from './kacheryStorage/KacheryStorageManager';
import AnnounceService from './services/AnnounceService';
import BootstrapService from './services/BootstrapService';
import DaemonApiServer from './services/DaemonApiServer';
import DiscoverService from './services/DiscoverService';
import MulticastService from './services/MulticastService';
import ProxyClientService from './services/ProxyClientService';
import PublicApiServer from './services/PublicApiServer';
import PublicUdpSocketServer from './services/PublicUdpSocketServer';
import PublicWebSocketServer from './services/PublicWebSocketServer';
import { durationMsec, DurationMsec } from './udp/UdpCongestionManager';

const startDaemon = async (args: {
    channelNames: ChannelName[],
    configDir: LocalFilePath,
    verbose: number,
    hostName: HostName | null,
    daemonApiPort: Port | null,
    httpListenPort: Port | null,
    webSocketListenPort: Port | null,
    udpListenPort: Port | null,
    label: string,
    bootstrapAddresses: Address[] | null,
    httpPostJsonFunction: ((address: Address, path: UrlPath, data: Object, opts: {timeoutMsec: DurationMsec}) => Promise<JSONObject>),
    dgramCreateSocketFunction: DgramCreateSocketFunction,
    opts: {
        noBootstrap: boolean,
        isBootstrapNode: boolean,
        mock: boolean
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
        httpPostJsonFunction,
        dgramCreateSocketFunction,
        opts
    } = args
    const kNode = new KacheryP2PNode({
        configDir,
        verbose,
        hostName,
        httpListenPort,
        webSocketListenPort,
        udpListenPort,
        label,
        bootstrapAddresses,
        channelNames,
        httpPostJsonFunction,
        dgramCreateSocketFunction,
        opts
    })

    // Start the daemon http server
    const daemonApiServer = new DaemonApiServer(kNode, { verbose });
    if (daemonApiPort) {
        daemonApiServer.listen(daemonApiPort);
        console.info(`Daemon http server listening on port ${daemonApiPort}`)
    }
    
    // Start the public http server
    const publicApiServer = new PublicApiServer(kNode, { verbose })
    if (httpListenPort) {
        publicApiServer.listen(httpListenPort);
        console.info(`Public http server listening on port ${httpListenPort}`)
    }

    // Start the websocket server
    let publicWebSocketServer: PublicWebSocketServer | null = null
    if (webSocketListenPort) {
        publicWebSocketServer = new PublicWebSocketServer(kNode, { verbose });
        await publicWebSocketServer.startListening(webSocketListenPort);
        console.info(`Websocket server listening on port ${webSocketListenPort}`)
    }

    // Start the udp socket server
    let publicUdpSocketServer: PublicUdpSocketServer | null = null
    if (udpListenPort) {
        publicUdpSocketServer = new PublicUdpSocketServer(kNode);
        await publicUdpSocketServer.startListening(udpListenPort);
        kNode.setPublicUdpSocketServer(publicUdpSocketServer)
        console.info(`Udp socket server listening on port ${udpListenPort}`)
    }

    const speedupFactor = opts.mock ? 1000 : 1

    // start the other services
    const announceService = new AnnounceService(kNode, {
        announceBootstrapIntervalMsec: durationMsec(21000 / speedupFactor),
        announceToRandomNodeIntervalMsec: durationMsec(2000 / speedupFactor)
    })
    const discoverService = new DiscoverService(kNode, {
        discoverBootstrapIntervalMsec: durationMsec(30000 / speedupFactor),
        discoverRandomNodeIntervalMsec: durationMsec(2200 / speedupFactor)
    })
    const bootstrapService = new BootstrapService(kNode, {
        probeIntervalMsec: durationMsec(15000 / speedupFactor)
    })
    const proxyClientService = new ProxyClientService(kNode, {
        intervalMsec: durationMsec(3000 / speedupFactor)
    })
    const multicastService = new MulticastService(kNode, {
        intervalMsec: durationMsec(12000 / speedupFactor)
    })

    const _stop = () => {
        daemonApiServer.stop()
        publicApiServer.stop()
        if (publicWebSocketServer) {
            publicWebSocketServer.stop()
        }
        if (publicUdpSocketServer) {
            publicUdpSocketServer.stop()
        }
        announceService.stop()
        discoverService.stop()
        bootstrapService.stop()
        proxyClientService.stop()
        multicastService.stop()
    }

    return {
        daemonApiServer,
        publicApiServer,
        publicWebSocketServer,
        publicUdpSocketServer,
        announceService,
        discoverService,
        bootstrapService,
        proxyClientService,
        multicastService,
        node: kNode,
        stop: _stop
    }
}

export default startDaemon