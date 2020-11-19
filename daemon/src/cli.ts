#!/usr/bin/env node

import Axios from 'axios';
import fs from 'fs';
import yaml from 'js-yaml';
import os from 'os';
import yargs from 'yargs';
import GarbageMap from './common/GarbageMap';
import { parseBootstrapInfo, randomAlphaString } from './common/util';
import realExternalInterface from './external/real/realExternalInterface';
import { Address, ChannelName, HostName, isAddress, isArrayOf, isChannelName, isHostName, isNodeId, isPort, isString, isUrlString, LocalFilePath, localFilePath, NodeId, nodeLabel, optional, toPort, _validateObject } from './interfaces/core';
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

interface YamlConfigTrustedNode {
  label: string,
  nodeId: NodeId
}
const isYamlConfigTrustedNode = (x: any): x is YamlConfigTrustedNode => {
  return _validateObject(x, {
    label: isString,
    nodeId: isNodeId
  })
}

interface YamlConfigChannel {
  channelName: ChannelName,
  trustedNodes?: YamlConfigTrustedNode[]
}
const isYamlConfigChannel = (x: any): x is YamlConfigChannel => {
  return _validateObject(x, {
    channelName: isChannelName,
    trustedNodes: optional(isArrayOf(isYamlConfigTrustedNode))
  })
}

interface YamlConfig {
  bootstrapAddresses?: Address[],
  channels?: YamlConfigChannel[]
}

const isYamlConfig = (x: any): x is YamlConfig => {
  return _validateObject(x, {
    bootstrapAddresses: optional(isArrayOf(isAddress)),
    channels: optional(isArrayOf(isYamlConfigChannel))
  })
}

function main() {
  const argv = yargs
    .scriptName('kachery-p2p-daemon')
    .command({
      command: 'start',
      describe: 'Start the daemon',
      builder: (y) => {
        y.option('config', {
          describe: 'File path or URL of the .yaml configuration file to use',
          type: 'string',
          default: ''
        })
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
          describe: 'Label for this node.',
          type: 'string',
          default: ''
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
          describe: 'Specify the websocket port to listen on (required for ismessageproxy and/or isdataproxy).',
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
        y.option('ismessageproxy', {
          describe: 'Allow this node to be used as a message proxy node for the channels it is in',
          type: 'boolean'
        })
        y.option('isdataproxy', {
          describe: 'Allow this node to be used as a data proxy node for the channels it is in',
          type: 'boolean'
        })
        y.option('nomulticast', {
          describe: 'Do not use multicast udp',
          type: 'boolean'
        })
        return y
      },
      handler: async (argv) => {
        const hostName = argv.host || null;
        const publicUrl = argv['public-url'] || null;
        const httpListenPort = argv['http-port'] ? Number(argv['http-port']) || null : 14507
        const udpSocketPort = argv['udp-port'] ? Number(argv['udp-port']) : httpListenPort || await findAvailableUdpPort()
        const webSocketListenPort = argv['websocket-port'] ? Number(argv['websocket-port']) : null
        const daemonApiPort = Number(process.env.KACHERY_P2P_API_PORT || 20431)
        const label = nodeLabel(argv.label as string)
        const noBootstrap = argv['nobootstrap'] ? true : false
        const isBootstrapNode = argv['isbootstrap'] ? true : false
        const isMessageProxy = argv['ismessageproxy'] ? true : false
        const isDataProxy = argv['isdataproxy'] ? true : false
        const noMulticast = argv['nomulticast'] ? true : false
        const verbose = Number(argv.verbose || 0)

        if ((isMessageProxy) || (isDataProxy)) {
          if (webSocketListenPort === null) {
            throw Error('You must specify a websocket-port when using --ismessageproxy or --isdataproxy')
          }
        }

        let yamlConfig: YamlConfig = {}
        if (argv.config) {
          const c = await loadConfig(argv.config as any as string)
          if (!isYamlConfig(c)) {
            console.warn(c)
            throw Error('Invalid .yaml configuration')
          }
          yamlConfig = c
        }

        const trustedNodesInChannels = new GarbageMap<ChannelName, NodeId[]>(null)
        const channelNames = ((argv.channel || []) as ChannelName[]).map(ch => {
          if (!isChannelName(ch)) throw new CLIError('Invalid channel name');
          return ch;
        })
        channelNames.forEach(ch => {
          trustedNodesInChannels.set(ch, [])
        })
        if (yamlConfig.channels) {
          yamlConfig.channels.forEach(ch => {
            channelNames.push(ch.channelName)
            if (ch.trustedNodes) {
              trustedNodesInChannels.set(ch.channelName, ch.trustedNodes.map(tn => tn.nodeId))
            }
            else {
              trustedNodesInChannels.set(ch.channelName, [])
            }
          })
        }
        console.info(`Joining channels: ${channelNames.map(c => (c.toString())).join(', ')}`)

        const bootstrapStrings: any[] | null = argv.bootstrap as (any[] | null) || null;
        let bootstrapAddresses = bootstrapStrings ? (
          bootstrapStrings.filter((x: any) => (typeof(x) === 'string')).map((x: string) => parseBootstrapInfo(x))
        ): [];

        const configDir = (process.env.KACHERY_P2P_CONFIG_DIR || `${os.homedir()}/.kachery-p2p`) as any as LocalFilePath
        if (!fs.existsSync(configDir.toString())) {
          fs.mkdirSync(configDir.toString());
        }

        if ((!noBootstrap) && (bootstrapAddresses.length === 0)) {
          if (yamlConfig.bootstrapAddresses) {
            console.info(`Using ${yamlConfig.bootstrapAddresses.length} bootstrap addresses from .yaml config`)
            bootstrapAddresses = yamlConfig.bootstrapAddresses
          }
          else {
            bootstrapAddresses = []
            // bootstrapAddresses = [
            //   {hostName: '45.33.92.31', port: toPort(46003)}, // kachery-p2p-spikeforest
            //   {hostName: '45.33.92.33', port: toPort(46003)} // kachery-p2p-flatiron1
            // ].map(bpi => {
            //     if (isAddress(bpi)) {
            //         return bpi
            //     }
            //     else {
            //         throw Error(`Not an address: ${bpi}`)
            //     }
            // })
          }
          bootstrapAddresses = bootstrapAddresses.filter(bpi => {
            if (!bpi.hostName) throw Error('Missing hostname in bootstrap server')
            if ((bpi.hostName.toString() === 'localhost') || (bpi.hostName === hostName)) {
                if (Number(bpi.port) === httpListenPort) {
                    return false
                }
            }
            else if ((publicUrl) && (bpi.url === publicUrl)) {
              return false
            }
            return true
          })
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

        const storageDir = process.env['KACHERY_STORAGE_DIR']
        if (!storageDir) {
            throw Error('You must set the KACHERY_STORAGE_DIR environment variable.');
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
            bootstrapAddresses: bootstrapAddresses,
            isBootstrap: isBootstrapNode,
            isMessageProxy,
            isDataProxy,
            channelNames,
            trustedNodesInChannels,
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

const cacheBust = (url: string) => {
  if (url.includes('?')) {
    return url + `&cb=${randomAlphaString(10)}`
  }
  else {
    return url + `?cb=${randomAlphaString(10)}`
  }
}

const loadConfig = async (pathOrUrl: string) => {
  let txt: string
  if ((pathOrUrl.startsWith('http://')) || (pathOrUrl.startsWith('https://'))) {
    txt = (await Axios.get(cacheBust(pathOrUrl))).data
  }
  else {
    txt = await fs.promises.readFile(pathOrUrl, 'utf-8')
  }
  return yaml.safeLoad(txt)
}

const findAvailableUdpPort = async (): Promise<number> => {
  return 14507
}

main();