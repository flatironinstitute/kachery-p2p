import DaemonApiServer from './DaemonApiServer';
import { Address, ChannelName, HostName, Port } from './interfaces/core';
import KacheryP2PController from './KacheryP2PController';
import KacheryP2PNode from './KacheryP2PNode';
import PublicApiServer from './PublicApiServer';
import PublicWebSocketServer from './PublicWebSocketServer';
import PublicUdpSocketServer from './udp/PublicUdpSocketServer';

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

  // Start the daemon http service
  const daemonApiServer = new DaemonApiServer(kNode, {verbose});
  daemonApiServer.listen(daemonApiPort);
  console.info(`Daemon http server listening on port ${daemonApiPort}`)

  // Start the public http service
  if (httpListenPort) {
    const publicApiServer = new PublicApiServer(kNode, {verbose});
    publicApiServer.listen(httpListenPort);
    console.info(`Public http server listening on port ${httpListenPort}`)
  }

  // Start the websocket service
  if (webSocketListenPort) {
    const publicWebSocketServer = new PublicWebSocketServer(kNode, {verbose});
    await publicWebSocketServer.startListening(webSocketListenPort);
    console.info(`Websocket server listening on port ${webSocketListenPort}`)
  }

  // Start the udp socket server
  if (udpListenPort) {
    const publicUdpSocketServer = new PublicUdpSocketServer(kNode);
    await publicUdpSocketServer.startListening(udpListenPort);
    console.info(`Udp socket server listening on port ${udpListenPort}`)
  }

  // start the services
  new KacheryP2PController(kNode)
}

export default startDaemon