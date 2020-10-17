import ExternalInterface from './external/ExternalInterface';
import { Address, ChannelName, durationMsec, HostName, KeyPair, Port } from './interfaces/core';
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
    keyPair: KeyPair,
    verbose: number,
    hostName: HostName | null,
    daemonApiPort: Port | null,
    httpListenPort: Port | null,
    webSocketListenPort: Port | null,
    udpListenPort: Port | null,
    label: string,
    bootstrapAddresses: Address[] | null,
    externalInterface: ExternalInterface,
    opts: {
        noBootstrap: boolean,
        isBootstrapNode: boolean,
        mock: boolean,
        multicastUdpAddress: string | null
    }
}) => {
    const {
        channelNames,
        keyPair,
        verbose,
        hostName,
        daemonApiPort,
        httpListenPort,
        webSocketListenPort,
        udpListenPort,
        label,
        bootstrapAddresses,
        externalInterface,
        opts
    } = args
    const kNode = new KacheryP2PNode({
        keyPair,
        verbose,
        hostName,
        httpListenPort,
        webSocketListenPort,
        udpListenPort,
        label,
        bootstrapAddresses,
        channelNames,
        externalInterface,
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
    let multicastService: MulticastService | null = null
    if (opts.multicastUdpAddress) {
        multicastService = new MulticastService(kNode, {
            intervalMsec: durationMsec(12000 / speedupFactor),
            multicastAddress: opts.multicastUdpAddress
        })
    }

    const _stop = () => {
        announceService.stop()
        discoverService.stop()
        bootstrapService.stop()
        proxyClientService.stop()
        if (multicastService) multicastService.stop()
        // wait a bit after stopping services before cleaning up the rest (for clean exit of services)
        setTimeout(() => {
            daemonApiServer.stop()
            publicApiServer.stop()
            setTimeout(() => {
                if (publicWebSocketServer) {
                    publicWebSocketServer.stop()
                }
                if (publicUdpSocketServer) {
                    publicUdpSocketServer.stop()
                }
                kNode.cleanup()
            }, 20)
        }, 20)
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