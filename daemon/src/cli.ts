#!/usr/bin/env ts-node

import os from 'os';
import fs from 'fs';
import yargs from 'yargs';
import KacheryP2PNode from './KacheryP2PNode';
import DaemonApiServer from './DaemonApiServer';
import PublicApiServer from './PublicApiServer';
import PublicWebSocketServer from './PublicWebSocketServer'; // todo
import assert from 'assert';
import { NodeId } from './interfaces/core';
import { ProxyConnectionToClient } from './ProxyConnectionToClient';

// Thanks: https://stackoverflow.com/questions/4213351/make-node-js-not-exit-on-error
process.on('uncaughtException', function (err) {
  // This is important because utp-native was sporadically giving the following error and crashing:
  /*

  /home/root/.npm/_npx/19496/lib/node_modules/kachery-p2p-daemon/node_modules/utp-native/lib/connection.js:238
  const err = new Error(str)               ^
  Error: UTP_ECONNRESET
      at createUTPError (/home/root/.npm/_npx/19496/lib/node_modules/kachery-p2p-daemon/node_modules/utp-native/lib/connection.js:238:15)
      at Connection._onerror (/home/root/.npm/_npx/19496/lib/node_modules/kachery-p2p-daemon/node_modules/utp-native/lib/connection.js:175:16)
  Emitted 'error' event on Connection instance at:
      at Connection._onclose (/home/root/.npm/_npx/19496/lib/node_modules/kachery-p2p-daemon/node_modules/utp-native/lib/connection.js:169:25) {
    code: 'UTP_ECONNRESET',
    errno: 1
  }

  */
  console.warn(err.stack);
  console.log('Uncaught exception: ', err);
});

function main() {
  const argv = yargs()
    .scriptName('kachery-p2p-daemon')
    .command({
      command: 'start',
      desc: 'Start the daemon',
      builder: (yargs) => {
        yargs.option('channel', {
          describe: 'Name of a kachery-p2p channel to join (you can join more than one)',
          type: 'array',
        })
        yargs.option('verbose', {
          describe: 'Verbosity level.',
          type: 'number',
          default: 0
        })
        yargs.option('host', {
          describe: 'host name or IP address of this daemon.',
          type: 'string',
          default: ''
        })
        yargs.option('label', {
          describe: 'Label for this node.',
          type: 'string',
          default: os.hostname()
        })
        yargs.option('port', {
          describe: 'Override the default http port to listen on.',
          type: 'string'
        })
        yargs.option('udp-port', {
          describe: 'Override the default UDP port (by default it will equal the http port).',
          type: 'string'
        })
        yargs.option('websocket-port', {
          describe: 'Override the default websocket port to listen on.',
          type: 'string'
        })
        yargs.option('bootstrap', {
          describe: 'Override the default bootstrap nodes. Use --bootstrap <host-or-ip>:<port>',
          type: 'array',
        })
        yargs.option('no-bootstrap', {
          describe: 'Do not use bootstrap nodes',
          type: 'boolean'
        })
      },
      handler: (argv) => {
        const channelNames = argv.channel || [];
        const bootstrapStrings = argv.bootstrap || null;
        const bootstrapInfos = bootstrapStrings ? (
          bootstrapStrings.map(x => parseBootstrapInfo(x))
        ): null;
        const configDir = process.env.KACHERY_P2P_CONFIG_DIR || `${os.homedir()}/.kachery-p2p`;
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir);
        }
        const hostName = argv.host || null;
        const httpListenPort = argv.port ? Number(argv.port) : 14507;
        const udpListenPort = argv['udp-port'] ? Number(argv['udp-port']) : httpListenPort;
        const webSocketListenPort = argv['websocket-port'] ? Number(argv['websocket-port']) : 14508;
        const daemonApiPort = process.env.KACHERY_P2P_DAEMON_API_PORT || process.env.KACHERY_P2P_API_PORT || 20431;
        const label = argv.label;
        const noBootstrap = argv['no-bootstrap'] ? true : false;
        const verbose = argv.verbose || 0;
        startDaemon({
          channelNames,
          configDir,
          verbose,
          hostName,
          daemonApiPort,
          httpListenPort,
          webSocketListenPort,
          udpListenPort,
          label,
          bootstrapInfos,
          opts: {
            noBootstrap
          }
        });
      }
    })
    .demandCommand()
    .strict()
    .help()
    .wrap(72)
    .argv
}

function parseBootstrapInfo(x) {
  const a = x.split(':');
  assert(a.length === 2, 'Improper bootstrap string')
  return {
    hostName: a[0],
    port: Number(a[1])
  };
}

const startDaemon = async ({
  channelNames,
  configDir,
  verbose,
  hostName,
  daemonApiPort,
  httpListenPort,
  webSocketListenPort,
  udpListenPort,
  label,
  bootstrapInfos,
  opts
}) => {
  // const daemon = new Daemon({configDir, verbose, discoveryVerbose, listenHost, listenPort, udpListenPort: listenPort, label, bootstrapInfos, opts});
  const kNode = new KacheryP2PNode({
    configDir,
    verbose,
    httpAddress: {
      hostName,
      port: httpListenPort
    },
    webSocketAddress: {
      hostName,
      port: webSocketListenPort
    },
    label,
    bootstrapInfos,
    channelNames,
    opts
  })

  const daemonApiServer = new DaemonApiServer(kNode, {verbose});
  daemonApiServer.listen(daemonApiPort);

  if (httpListenPort) {
    const publicApiServer = new PublicApiServer(kNode, {verbose});
    publicApiServer.listen(httpListenPort);
  }

  if (webSocketListenPort) {
    const publicWebSocketServer = new PublicWebSocketServer(kNode, {verbose});
    await publicWebSocketServer.startListening(webSocketListenPort);
    console.info(`Websocket server listening on port ${webSocketListenPort}`)
    publicWebSocketServer.onIncomingProxyConnection((nodeId: NodeId, c: ProxyConnectionToClient) => {
      kNode.setProxyConnectionToClient(nodeId, c);
    });
  }

  if (udpListenPort) {
    const publicUdpSocketServer = new PublicWebSocketServer(kNode, {verbose});
    publicUdpSocketServer.listen(udpListenPort);
  }
}

main();