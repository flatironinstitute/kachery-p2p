#!/usr/bin/env ts-node

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import yargs from 'yargs';
import { createKeyPair, getSignature, hexToPrivateKey, hexToPublicKey, privateKeyToHex, publicKeyToHex, verifySignature } from './common/crypto_util';
import realExternalInterface from './external/real/realExternalInterface';
import { Address, isAddress, isChannelName, isHostName, isKeyPair, isPort, JSONObject, KeyPair } from './interfaces/core';
import { LocalFilePath } from './kacheryStorage/KacheryStorageManager';
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

        const keyPair = _loadKeypair(configDir as any as LocalFilePath)

        const externalInterface = realExternalInterface()

        startDaemon({
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

const _loadKeypair = (configDir: LocalFilePath): KeyPair => {
  if (!fs.existsSync(configDir.toString())) {
      throw Error(`Config directory does not exist: ${configDir}`)
  }
  const publicKeyPath = `${configDir.toString()}/public.pem`
  const privateKeyPath = `${configDir.toString()}/private.pem`
  if (fs.existsSync(publicKeyPath)) {
      if (!fs.existsSync(privateKeyPath)) {
          throw Error(`Public key file exists, but secret key file does not.`)
      }
  }
  else {
      const {publicKey, privateKey} = createKeyPair()
      fs.writeFileSync(publicKeyPath, publicKey.toString(), {encoding: 'utf-8'})
      fs.writeFileSync(privateKeyPath, privateKey.toString(), {encoding: 'utf-8'})
      fs.chmodSync(privateKeyPath, fs.constants.S_IRUSR | fs.constants.S_IWUSR)
  }

  const keyPair = {
      publicKey: fs.readFileSync(publicKeyPath, {encoding: 'utf-8'}),
      privateKey: fs.readFileSync(privateKeyPath, {encoding: 'utf-8'}),
  }
  if (!isKeyPair(keyPair)) {
      throw Error('Invalid keyPair')
  }
  testKeyPair(keyPair)
  return keyPair
}

const testKeyPair = (keyPair: KeyPair) => {
  const signature = getSignature({test: 1}, keyPair)
  if (!verifySignature({test: 1} as JSONObject, signature, keyPair.publicKey)) {
      throw new Error('Problem testing public/private keys. Error verifying signature.')
  }
  if (hexToPublicKey(publicKeyToHex(keyPair.publicKey)) !== keyPair.publicKey) {
      console.warn(hexToPublicKey(publicKeyToHex(keyPair.publicKey)))
      console.warn(keyPair.publicKey)
      throw new Error('Problem testing public/private keys. Error converting public key to/from hex.')
  }
  if (hexToPrivateKey(privateKeyToHex(keyPair.privateKey)) !== keyPair.privateKey) {
      throw new Error('Problem testing public/private keys. Error converting private key to/from hex.')
  }
}

export const readJsonFile = async (path: string) => {
  const txt = await fs.promises.readFile(path, 'utf-8');
  return JSON.parse(txt);
}

main();