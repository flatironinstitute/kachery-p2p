#!/usr/bin/env ts-node

import assert from 'assert';
import dgram from 'dgram';
import fs from 'fs';
import os from 'os';
import WebSocket from 'ws';
import yargs from 'yargs';
import { httpGetDownload, httpPostJson } from './common/httpPostJson';
import { Address, isAddress, isChannelName, isHostName, isPort, NodeId, Port } from './interfaces/core';
import { KacheryStorageManager, LocalFilePath } from './kacheryStorage/KacheryStorageManager';
import { isBuffer } from './proxyConnections/ProxyConnectionToClient';
import { WebSocketInterface, WebSocketServerInterface } from './services/PublicWebSocketServer';
import startDaemon from './startDaemon';
import { DurationMsec, durationMsecToNumber } from './udp/UdpCongestionManager';

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
  constructor(errorString: string) {
    super(errorString);
  }
}

const webSocketInterfaceFromWebSocket = (ws: WebSocket): WebSocketInterface => {
  const onMessage = (cb: (buf: Buffer) => void) => {
    ws.on('message', (buf) => {
      if (!isBuffer(buf)) {
        console.warn('Incoming message is not a Buffer')
        ws.close()
        return
      }
      cb(buf)
    })
  }
  const onError = (cb: (err: Error) => void) => {
    ws.on('error', (err) => {
      cb(err)
    })
  }
  const onClose = (cb: (code: number, reason: string) => void) => {
    ws.on('close', (code, reason) => {
      cb(code, reason)
    })
  }
  const onOpen = (cb: () => void) => {
    ws.on('open', () => {
      cb()
    })
  }
  return {
    onOpen,
    onMessage,
    onError,
    onClose,
    close: () => {ws.close()},
    send: (buf: Buffer) => {ws.send(buf)}
  }
}

const webSocketServerInterfaceFromWebSocketServer = (S: WebSocket.Server): WebSocketServerInterface => {
  const onConnection = (cb: (ws: WebSocketInterface) => void) => {
    S.on('connection', (ws: WebSocket) => {
      cb(webSocketInterfaceFromWebSocket(ws))
    })
  }
  const onListening = (cb: () => void) => {

  }
  return {
    onConnection,
    onListening,
    close: () => {S.close()}
  }
}

class StringParseError extends Error {
  constructor(errorString: string) {
    super(errorString);
  }
}

function main() {
  const argv = yargs
    .scriptName('kachery-p2p-daemon')
    .command({
      command: 'start',
      describe: 'Start the daemon',
      builder: (y) => {
        y.option('channel', {
          describe: 'Name of a kachery-p2p channel to join (you can join more than one)',
          type: 'array',
        })
        y.option('verbose', {
          describe: 'Verbosity level.',
          type: 'number',
          default: 0
        })
        y.option('host', {
          describe: 'host name or IP address of this daemon.',
          type: 'string',
          default: ''
        })
        y.option('label', {
          describe: 'Label for this node.',
          type: 'string',
          default: os.hostname()
        })
        y.option('port', {
          describe: 'Override the default http port to listen on.',
          type: 'string'
        })
        y.option('udp-port', {
          describe: 'Override the default UDP port (by default it will equal the http port).',
          type: 'string'
        })
        y.option('websocket-port', {
          describe: 'Override the default websocket port to listen on.',
          type: 'string'
        })
        y.option('bootstrap', {
          describe: 'Override the default bootstrap nodes. Use --bootstrap <host-or-ip>:<port>',
          type: 'array',
        })
        y.option('no-bootstrap', {
          describe: 'Do not use bootstrap nodes',
          type: 'boolean'
        })
        y.option('is-bootstrap', {
          describe: 'Mark this node as a bootstrap node',
          type: 'boolean'
        })
        return y
      },
      handler: (argv) => {
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

        const dgramCreateSocket = (args: {type: 'udp4', reuseAddr: boolean}) => {
          return dgram.createSocket({type: args.type, reuseAddr: args.reuseAddr})
        }

        const createWebSocketServer = (port: Port, nodeId: NodeId): WebSocketServerInterface => {
          const S = new WebSocket.Server({port: port as any as number})
          return webSocketServerInterfaceFromWebSocketServer(S)
        }

        const createWebSocket = (url: string, opts: {timeoutMsec: DurationMsec}): WebSocketInterface => {
          const ws = new WebSocket(url, {timeout: durationMsecToNumber(opts.timeoutMsec)})
          return webSocketInterfaceFromWebSocket(ws)
        }

        const kacheryStorageManager = new KacheryStorageManager()

        startDaemon({
          channelNames,
          configDir: configDir as any as LocalFilePath,
          verbose,
          hostName,
          daemonApiPort,
          httpListenPort,
          webSocketListenPort,
          udpListenPort,
          label,
          bootstrapAddresses,
          httpPostJsonFunction: httpPostJson,
          httpGetDownloadFunction: httpGetDownload,
          dgramCreateSocketFunction: dgramCreateSocket,
          createWebSocketServerFunction: createWebSocketServer,
          createWebSocketFunction: createWebSocket,
          kacheryStorageManager,
          opts: {
            noBootstrap,
            isBootstrapNode,
            mock: false,
            multicastUdpAddress: '237.0.0.0' // how to choose this?
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

main();