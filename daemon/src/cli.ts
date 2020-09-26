#!/usr/bin/env ts-node

import os from 'os';
import fs from 'fs';
import yargs from 'yargs';
import KacheryP2PNode from './KacheryP2PNode';
import DaemonApiServer from './DaemonApiServer';
import PublicApiServer from './PublicApiServer';
import PublicWebSocketServer from './PublicWebSocketServer';
import assert from 'assert';
import { ChannelName, HostName, isAddress, isChannelName, JSONObject, NodeId, Port, isHostName, isPort, Address } from './interfaces/core';
import { ProxyConnectionToClient } from './ProxyConnectionToClient';
import PublicUdpSocketServer from './PublicUdpSocketServer';

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

class CLIError extends Error {
  constructor(errorString) {
    super(errorString);
  }
}

class StringParseError extends Error {
  constructor(errorString) {
    super(errorString);
  }
}

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
        yargs.option('is-bootstrap', {
          describe: 'Mark this node as a bootstrap node',
          type: 'boolean'
        })
      },
      handler: (argv: JSONObject) => {
        const channelNames = ((argv.channel || []) as string[]).map(ch => {
          if (!isChannelName(ch)) throw new CLIError('Invalid channel name');
          return ch;
        });
        
        const bootstrapStrings = argv.bootstrap || null;
        const bootstrapAddresses = bootstrapStrings ? (
          (bootstrapStrings as string[]).map(x => parseBootstrapInfo(x))
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
        const label = argv.label as string;
        const noBootstrap = argv['no-bootstrap'] ? true : false;
        const isBootstrapNode = argv['is-bootstrap'] ? true : false;
        const verbose = Number(argv.verbose || 0);

        if (hostName !== null) {
          if (!isHostName(hostName)) {
            throw new CLIError('Invalid host name');
          }
        }
        if (!isPort(daemonApiPort)) {
          throw new CLIError('Invalid daemon api port');
        }
        if (httpListenPort !== null) {
          if (!isPort(httpListenPort)) {
            throw new CLIError('Invalid http listen port');
          }
        }
        if (webSocketListenPort !== null) {
          if (!isPort(webSocketListenPort)) {
            throw new CLIError('Invalid websocket listen port');
          }
        }
        if (udpListenPort !== null) {
          if (!isPort(udpListenPort)) {
            throw new CLIError('Invalid udp listen port');
          }
        }

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
          bootstrapAddresses,
          opts: {
            noBootstrap,
            isBootstrapNode
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

function parseBootstrapInfo(x: string): Address {
  const a = x.split(':');
  assert(a.length === 2, 'Improper bootstrap string')
  const b = {
    hostName: a[0],
    port: Number(a[1])
  };
  if (!isAddress(b)) {
    throw new StringParseError('Improper bootstrap info.');
  }
  return b;
}

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

  const daemonApiServer = new DaemonApiServer(kNode, {verbose});
  daemonApiServer.listen(daemonApiPort);
  console.info(`Daemon http server listening on port ${daemonApiPort}`)

  if (httpListenPort) {
    const publicApiServer = new PublicApiServer(kNode, {verbose});
    publicApiServer.listen(httpListenPort);
    console.info(`Public http server listening on port ${httpListenPort}`)
  }

  if (webSocketListenPort) {
    const publicWebSocketServer = new PublicWebSocketServer(kNode, {verbose});
    await publicWebSocketServer.startListening(webSocketListenPort);
    console.info(`Websocket server listening on port ${webSocketListenPort}`)
  }

  if (udpListenPort) {
    const publicUdpSocketServer = new PublicUdpSocketServer(kNode);
    await publicUdpSocketServer.startListening(udpListenPort);
    console.info(`Udp socket server listening on port ${udpListenPort}`)
  }
}

main();