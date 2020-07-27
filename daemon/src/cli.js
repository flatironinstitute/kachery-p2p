#!/usr/bin/env node

import os from 'os';
import fs from 'fs';
import yargs from 'yargs';
import Daemon from './Daemon.js';
import ApiServer from './ApiServer.js';

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
          describe: 'Verbosity level for hyperswarm discovery.',
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
      },
      handler: (argv) => {
        let channelNames = argv.channel || [];
        const configDir = process.env.KACHERY_P2P_CONFIG_DIR || `${os.homedir()}/.kachery-p2p`;
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir);
        }
        const listenHost = argv.host;
        const listenPort = argv.port;
        const label = argv.label;
        startDaemon({
          configDir,
          channelNames,
          listenHost,
          listenPort,
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

const apiPort = process.env.KACHERY_P2P_API_PORT || 20431;

class Log {
  constructor() {

  }
}

const startDaemon = async ({ channelNames, configDir, listenHost, listenPort, verbose, discoveryVerbose, label, opts }) => {
  const daemon = new Daemon({configDir, verbose, discoveryVerbose, listenHost, listenPort, udpListenPort: listenPort, label, opts});

  const apiServer = new ApiServer(daemon, {verbose});
  apiServer.listen(apiPort);

  for (let channelName of channelNames) {
    await daemon.joinChannel(channelName);
  }
}

main();