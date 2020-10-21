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

export interface StartDaemonOpts {
    bootstrapAddresses: Address[] | null,
    isBootstrap: boolean,
    channelNames: ChannelName[],
    multicastUdpAddress: string | null,
    udpListenPort: Port | null,
    webSocketListenPort: Port | null,
    services: {
        announce?: boolean,
        discover?: boolean,
        bootstrap?: boolean,
        proxyClient?: boolean,
        multicast?: boolean,
        udpServer?: boolean,
        webSocketServer?: boolean,
        httpServer?: boolean,
        daemonServer?: boolean
    }
}

const startDaemon = async (args: {
    keyPair: KeyPair,
    verbose: number,
    hostName: HostName | null,
    daemonApiPort: Port | null,
    httpListenPort: Port | null,
    label: string,
    externalInterface: ExternalInterface,
    opts: StartDaemonOpts
}) => {
    const {
        keyPair,
        verbose,
        hostName,
        daemonApiPort,
        httpListenPort,
        label,
        externalInterface,
        opts
    } = args
    const kNode = new KacheryP2PNode({
        keyPair,
        verbose,
        hostName,
        httpListenPort,
        webSocketListenPort: opts.webSocketListenPort,
        udpListenPort: opts.udpListenPort,
        label,
        bootstrapAddresses: opts.bootstrapAddresses,
        channelNames: opts.channelNames,
        externalInterface,
        opts: {
            noBootstrap: (opts.bootstrapAddresses === null),
            isBootstrapNode: opts.isBootstrap,
            multicastUdpAddress: opts.services.multicast ? opts.multicastUdpAddress : null
        }
    })

    // Start the daemon http server
    const daemonApiServer = new DaemonApiServer(kNode, { verbose });
    if (opts.services.daemonServer && daemonApiPort) {
        daemonApiServer.listen(daemonApiPort);
        console.info(`Daemon http server listening on port ${daemonApiPort}`)
    }
    
    // Start the public http server
    const publicApiServer = new PublicApiServer(kNode, { verbose })
    if (opts.services.httpServer && httpListenPort) {
        publicApiServer.listen(httpListenPort);
        console.info(`Public http server listening on port ${httpListenPort}`)
    }

    // Start the websocket server
    let publicWebSocketServer: PublicWebSocketServer | null = null
    if (opts.services.webSocketServer && opts.webSocketListenPort) {
        publicWebSocketServer = new PublicWebSocketServer(kNode, { verbose });
        await publicWebSocketServer.startListening(opts.webSocketListenPort);
        console.info(`Websocket server listening on port ${opts.webSocketListenPort}`)
    }

    // Start the udp socket server
    let publicUdpSocketServer: PublicUdpSocketServer | null = null
    if (opts.services.udpServer && opts.udpListenPort) {
        publicUdpSocketServer = new PublicUdpSocketServer(kNode);
        await publicUdpSocketServer.startListening(opts.udpListenPort);
        kNode.setPublicUdpSocketServer(publicUdpSocketServer)
        console.info(`Udp socket server listening on port ${opts.udpListenPort}`)
    }

    const speedupFactor = externalInterface.isMock ? 1000 : 1

    // start the other services
    const announceService = opts.services.announce ? new AnnounceService(kNode, {
        announceBootstrapIntervalMsec: durationMsec(21000 / speedupFactor),
        announceToRandomNodeIntervalMsec: durationMsec(2000 / speedupFactor)
    }) : null
    const discoverService = opts.services.discover ? new DiscoverService(kNode, {
        discoverBootstrapIntervalMsec: durationMsec(30000 / speedupFactor),
        discoverRandomNodeIntervalMsec: durationMsec(2200 / speedupFactor)
    }) : null
    const bootstrapService = opts.services.bootstrap ? new BootstrapService(kNode, {
        probeIntervalMsec: durationMsec(15000 / speedupFactor)
    }) : null
    const proxyClientService = opts.services.proxyClient ? new ProxyClientService(kNode, {
        intervalMsec: durationMsec(3000 / speedupFactor)
    }) : null
    let multicastService = (opts.services.multicast && (opts.multicastUdpAddress !== null)) ? new MulticastService(kNode, {
        intervalMsec: durationMsec(12000 / speedupFactor),
        multicastAddress: opts.multicastUdpAddress
    }) : null

    const _stop = () => {
        announceService && announceService.stop()
        discoverService && discoverService.stop()
        bootstrapService && bootstrapService.stop()
        proxyClientService && proxyClientService.stop()
        multicastService && multicastService.stop()
        // wait a bit after stopping services before cleaning up the rest (for clean exit of services)
        setTimeout(() => {
            daemonApiServer && daemonApiServer.stop()
            publicApiServer && publicApiServer.stop()
            setTimeout(() => {
                publicWebSocketServer && publicWebSocketServer.stop()
                publicUdpSocketServer && publicUdpSocketServer.stop()
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