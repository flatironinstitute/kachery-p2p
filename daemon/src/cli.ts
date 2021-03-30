#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import yargs from 'yargs';
import realExternalInterface from './external/real/realExternalInterface';
import { Address, ChannelLabel, HostName, isAddress, isArrayOf, isBoolean, isChannelLabel, isHostName, isNodeId, isNodeLabel, isPort, isUrlString, LocalFilePath, localFilePath, NodeId, NodeLabel, nodeLabel, optional, toPort, _validateObject } from './interfaces/core';
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

export interface IsAdmin extends Boolean {
  __isAdmin__: never; // phantom
}
export interface IsMessageProxy extends Boolean {
  __isMessageProxy__: never; // phantom
}
export interface IsDataProxy extends Boolean {
  __isDataProxy__: never; // phantom
}
export interface IsPublic extends Boolean {
  __isPublic__: never; // phantom
}

export interface ChannelConfigAuthorizedNode {
  nodeId: NodeId
  nodeLabel: NodeLabel
  isAdmin?: IsAdmin
  isMessageProxy?: IsMessageProxy
  isDataProxy?: IsDataProxy
  isPublic?: IsPublic
}

export const isChannelConfigAuthorizedNode = (x: any): x is ChannelConfigAuthorizedNode => {
  return _validateObject(x, {
    nodeId: isNodeId,
    nodeLabel: isNodeLabel,
    isAdmin: optional(isBoolean),
    isMessageProxy: optional(isBoolean),
    isDataProxy: optional(isBoolean),
    isPublic: optional(isBoolean)
  }, {allowAdditionalFields: true})
}

export interface ChannelConfig {
  channelLabel: ChannelLabel
  bootstrapAddresses: Address[]
  authorizedNodes: ChannelConfigAuthorizedNode[]
}

export const isChannelConfig = (x: any): x is ChannelConfig => {
  return _validateObject(x, {
    channelLabel: isChannelLabel,
    bootstrapAddresses: isArrayOf(isAddress),
    authorizedNodes: isArrayOf(isChannelConfigAuthorizedNode)
  }, {allowAdditionalFields: true})
}

function main() {
  const argv = yargs
    .scriptName('kachery-p2p-daemon')
    .command({
      command: 'start',
      describe: 'Start the daemon',
      builder: (y) => {
        y.option('verbose', {
          describe: 'Verbosity level.',
          type: 'number',
          default: 0
        })
        y.option('host', {
          describe: 'host name or IP address of this node.',
          type: 'string',
          default: ''
        })
        y.option('public-url', {
          describe: 'Base URL for public http access',
          type: 'string',
          default: ''
        })
        y.option('label', {
          describe: 'Label for this node (required).',
          type: 'string'
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
          describe: 'Specify the websocket port to listen on (required message proxy and/or data proxy nodes).',
          type: 'string'
        })
        y.option('isbootstrap', {
          describe: 'Mark this node as a bootstrap node',
          type: 'boolean'
        })
        y.option('noudp', {
          describe: 'Do not use a udp socket',
          type: 'boolean'
        })
        y.option('nomulticast', {
          describe: 'Do not use multicast udp',
          type: 'boolean'
        })
        y.option('static-config', {
          describe: 'Path or URL to a config file for static configuration',
          type: 'string'
        })
        y.option('auth-group', {
          describe: 'The os group that has access to this daemon',
          type: 'string'
        })
        return y
      },
      handler: async (argv) => {
        const hostName = argv.host || null;
        const publicUrl = argv['public-url'] || null;
        const httpListenPort = argv['http-port'] ? Number(argv['http-port']) || null : null
        const noUdp = argv['noudp'] ? true : false
        if (noUdp) {
          if (argv['udp-port']) throw Error('Cannot specify a --udp-port with the --noudp option')
        }
        const udpSocketPort: number | null = (!noUdp) ? ((argv['udp-port'] ? Number(argv['udp-port']) : httpListenPort) || 14507) : null
        const webSocketListenPort = argv['websocket-port'] ? Number(argv['websocket-port']) : null
        const daemonApiPort = Number(process.env.KACHERY_P2P_API_PORT || 20431)
        const label = nodeLabel(argv.label as string)
        const isBootstrapNode = argv['isbootstrap'] ? true : false
        
        const noMulticast = argv['nomulticast'] ? true : false
        const verbose = Number(argv.verbose || 0)
        const staticConfigPathOrUrl: string | null = argv['static-config'] ? argv['static-config'] + '' : null 
        const authGroup: string | null = argv['auth-group'] ? argv['auth-group'] + '' : null 

        const configDir = (process.env.KACHERY_P2P_CONFIG_DIR || `${os.homedir()}/.kachery-p2p`) as any as LocalFilePath
        if (!fs.existsSync(configDir.toString())) {
          fs.mkdirSync(configDir.toString());
        }

        if (hostName !== null) {
          if (!isHostName(hostName)) {
            throw new CLIError('Invalid host name');
          }
        }
        if (publicUrl !== null) {
          if (!isUrlString(publicUrl)) {
            throw new CLIError('Invalid public url');
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

        let storageDir = process.env['KACHERY_STORAGE_DIR'] || ''
        if (!storageDir) {
          storageDir = `${os.homedir()}/kachery-storage`
            console.warn(`Using ${storageDir} for storage. Set KACHERY_STORAGE_DIR to override.`);
            if (!fs.existsSync(storageDir)) {
              fs.mkdirSync(storageDir)
            }
        }
        if (!fs.lstatSync(storageDir).isDirectory()) {
          throw new CLIError(`Storage path is not a directory: ${storageDir}`)
        }        

        const externalInterface = realExternalInterface(localFilePath(storageDir), configDir)

        startDaemon({
          configDir,
          verbose,
          hostName,
          publicUrl,
          daemonApiPort,
          httpListenPort,
          label,
          externalInterface,
          getDefects: () => {return {}}, // no defects
          opts: {
            isBootstrap: isBootstrapNode,
            multicastUdpAddress: {hostName: '237.0.0.0' as any as HostName, port: toPort(21010)}, // how to choose this?
            udpSocketPort,
            webSocketListenPort,
            firewalled: false,
            staticConfigPathOrUrl,
            authGroup,
            services: {
                announce: true,
                discover: true,
                bootstrap: true,
                proxyClient: true,
                configUpdate: true,
                multicast: (!noUdp) ? ((!noMulticast) ? true : false) : false,
                display: true,
                udpSocket: !noUdp,
                webSocketServer: webSocketListenPort ? true : false,
                httpServer: true,
                daemonServer: true,
                mirror: true,
                clientAuth: true
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