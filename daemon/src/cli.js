#!/usr/bin/env node

import os from 'os';
import fs from 'fs';
import yargs from 'yargs';
import Daemon from './Daemon.js';
import ApiServer from './ApiServer.js';
import FileServer from './FileServer.js';
import assert from 'assert';

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
  // for (let i=0; i<10; i++) {
  //   const keyPair = createKeyPair();
  //   console.info(publicKeyToHex(keyPair.publicKey));
  // }
  // for (let i=0; i<10; i++) {
  //   const keyPair = createKeyPair();
  //   console.info(privateKeyToHex(keyPair.privateKey));
  // }
  // return;
  const argv = yargs
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
        yargs.option('dverbose', {
          describe: 'Verbosity level for discovery.',
          type: 'number',
          default: 0
        })
        yargs.option('host', {
          describe: 'IP of this daemon.',
          type: 'string',
          default: ''
        })
        yargs.option('label', {
          describe: 'Label for this node.',
          type: 'string',
          default: os.hostname()
        })
        yargs.option('port', {
          describe: 'Port to listen on.',
          type: 'string'
        })
        yargs.option('file-server-port', {
          describe: 'Optional port for serving static files over http.',
          type: 'string'
        })
        yargs.option('bootstrap', {
          describe: 'Override the default bootstrap node. Use --bootstrap ip:port',
          type: 'array',
        })
      },
      handler: (argv) => {
        let channelNames = argv.channel || [];
        let bootstrapStrings = argv.bootstrap || null;
        const bootstrapInfos = bootstrapStrings ? (
          bootstrapStrings.map(x => parseBootstrapInfo(x))
        ): null;
        const configDir = process.env.KACHERY_P2P_CONFIG_DIR || `${os.homedir()}/.kachery-p2p`;
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir);
        }
        const listenHost = argv.host;
        const listenPort = argv.port ? Number(argv.port) : null;
        const fileServerPort = argv['file-server-port'] ? Number(argv['file-server-port']) : null;
        const label = argv.label;
        startDaemon({
          configDir,
          channelNames,
          bootstrapInfos,
          listenHost,
          listenPort,
          fileServerPort,
          verbose: argv.verbose,
          discoveryVerbose: argv.dverbose,
          label,
          opts: {
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
    address: a[0],
    port: Number(a[1])
  };
}

const apiPort = process.env.KACHERY_P2P_API_PORT || 20431;

class Log {
  constructor() {

  }
}

const startDaemon = async ({ channelNames, configDir, listenHost, listenPort, fileServerPort, verbose, discoveryVerbose, label, bootstrapInfos, opts }) => {
  const daemon = new Daemon({configDir, verbose, discoveryVerbose, listenHost, listenPort, udpListenPort: listenPort, label, bootstrapInfos, opts});

  const apiServer = new ApiServer(daemon, {verbose});
  apiServer.listen(apiPort);

  if (fileServerPort) {
    const fileServer = new FileServer({verbose});
    fileServer.listen(fileServerPort);
  }

  for (let channelName of channelNames) {
    daemon.joinChannel(channelName);
  }
}

main();