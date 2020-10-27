#!/usr/bin/env ts-node

import fs from 'fs';
import os from 'os';
import yargs from 'yargs';
import { parseBootstrapInfo } from './common/util';
import realExternalInterface from './external/real/realExternalInterface';
import { HostName, isAddress, isChannelName, isHostName, isPort, LocalFilePath, localFilePath, toPort } from './interfaces/core';
import startDaemon from './startDaemon';

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
        y.option('http-port', {
          describe: 'Override the default daemon http port to listen on.',
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
          type: 'array'
        })
        y.option('nobootstrap', {
          describe: 'Do not use bootstrap nodes',
          type: 'boolean'
        })
        y.option('isbootstrap', {
          describe: 'Mark this node as a bootstrap node',
          type: 'boolean'
        })
        y.option('nomulticast', {
          describe: 'Do not use multicast udp',
          type: 'boolean'
        })
        return y
      },
      handler: (argv) => {
        const channelNames = ((argv.channel || []) as string[]).map(ch => {
          if (!isChannelName(ch)) throw new CLIError('Invalid channel name');
          return ch;
        });
        
        const bootstrapStrings: any[] | null = argv.bootstrap as (any[] | null) || null;
        let bootstrapAddresses = bootstrapStrings ? (
          bootstrapStrings.filter((x: any) => (typeof(x) === 'string')).map((x: string) => parseBootstrapInfo(x))
        ): [];
        const configDir = (process.env.KACHERY_P2P_CONFIG_DIR || `${os.homedir()}/.kachery-p2p`) as any as LocalFilePath
        if (!fs.existsSync(configDir.toString())) {
          fs.mkdirSync(configDir.toString());
        }
        const hostName = argv.host || null;
        const httpListenPort = argv['http-port'] ? Number(argv['http-port']) || null : 14507
        const udpSocketPort = argv['udp-port'] ? Number(argv['udp-port']) : httpListenPort || 14507
        const webSocketListenPort = argv['websocket-port'] ? Number(argv['websocket-port']) : null
        const daemonApiPort = Number(process.env.KACHERY_P2P_DAEMON_API_PORT || process.env.KACHERY_P2P_API_PORT || 20431)
        const label = argv.label as string;
        const noBootstrap = argv['nobootstrap'] ? true : false;
        const isBootstrapNode = argv['isbootstrap'] ? true : false;
        const noMulticast = argv['nomulticast'] ? true : false;
        const verbose = Number(argv.verbose || 0);

        if ((!noBootstrap) && (bootstrapAddresses.length === 0)) {
          bootstrapAddresses = [
            // todo - set these properly
            {hostName: '45.33.92.31', port: toPort(46003)}, // kachery-p2p-spikeforest
            {hostName: '45.33.92.33', port: toPort(46003)} // kachery-p2p-flatiron1
          ].map(bpi => {
              if (isAddress(bpi)) {
                  return bpi
              }
              else {
                  throw Error(`Not an address: ${bpi}`)
              }
          }).filter(bpi => {
              if ((bpi.hostName === 'localhost') || (bpi.hostName === hostName)) {
                  if (Number(bpi.port) === httpListenPort) {
                      return false
                  }
              }
              return true
          })
        }

        if (hostName !== null) {
          if (!isHostName(hostName)) {
            throw new CLIError('Invalid host name');
          }
        }
        if (!isPort(daemonApiPort)) {
          throw new CLIError(`Invalid daemon api port: ${daemonApiPort}`);
        }
        if (httpListenPort !== null) {
          if (!isPort(httpListenPort)) {
            throw new CLIError(`Invalid http listen port: ${httpListenPort}`);
          }
        }
        if (webSocketListenPort !== null) {
          if (!isPort(webSocketListenPort)) {
            throw new CLIError('Invalid websocket listen port');
          }
        }
        if (udpSocketPort !== null) {
          if (!isPort(udpSocketPort)) {
            throw new CLIError('Invalid udp listen port');
          }
        }

        const storageDir = process.env['KACHERY_STORAGE_DIR']
        if (!storageDir) {
            throw Error('You must set the KACHERY_STORAGE_DIR environment variable.');
        }

        const externalInterface = realExternalInterface(localFilePath(storageDir), configDir)

        startDaemon({
          configDir,
          verbose,
          hostName,
          daemonApiPort,
          httpListenPort,
          label,
          externalInterface,
          getDefects: () => {return {}}, // no defects
          opts: {
            bootstrapAddresses: bootstrapAddresses,
            isBootstrap: isBootstrapNode,
            channelNames,
            multicastUdpAddress: {hostName: '237.0.0.0' as any as HostName, port: toPort(21010)}, // how to choose this?
            udpSocketPort,
            webSocketListenPort,
            firewalled: false,
            services: {
                announce: true,
                discover: true,
                bootstrap: noBootstrap ? false : true,
                proxyClient: true,
                multicast: noMulticast ? false : true,
                display: true,
                udpSocket: true,
                webSocketServer: webSocketListenPort ? true : false,
                httpServer: true,
                daemonServer: true
            }
          }
        })
      }
    })
    .demandCommand()
    .strict()
    .help()
    .wrap(72)
    .argv
}

main();