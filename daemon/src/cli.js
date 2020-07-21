#!/usr/bin/env node

import os from 'os';
import fs from 'fs';
import yargs from 'yargs';
import Daemon from './Daemon.js';
import Hub from './Hub.js';
import ApiServer from './ApiServer.js';

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
        yargs.option('host', {
          describe: 'IP of this daemon.',
          type: 'string',
          default: ''
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
        startDaemon({ configDir, channelNames, listenHost, listenPort, proxyHost: null, proxyPort: null, verbose: argv.verbose });
      }
    })
    .command({
      command: 'start-hub',
      desc: 'Start a hub',
      builder: (yargs) => {
        yargs.option('port', {
          describe: 'Port to listen on',
          type: 'number',
        })
        yargs.option('verbose', {
          describe: 'Verbosity level.',
          type: 'number',
          default: 0
        })
      },
      handler: (argv) => {
        let port = argv.port || 8080;
        const configDir = process.env.KACHERY_P2P_CONFIG_DIR || `${os.homedir()}/.kachery-p2p`;
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir);
        }
        startHub({ configDir, port, verbose: argv.verbose });
      }
    })
    .demandCommand()
    .strict()
    .help()
    .wrap(72)
    .argv
}

const apiPort = process.env.KACHERY_P2P_API_PORT || 20431;

const startDaemon = async ({ channelNames, configDir, listenHost, listenPort, proxyHost, proxyPort, verbose }) => {
  const daemon = new Daemon({configDir, verbose, listenHost, listenPort, proxyHost, proxyPort});

  const apiServer = new ApiServer(daemon, {verbose});
  apiServer.listen(apiPort);

  for (let channelName of channelNames) {
    await daemon.joinChannel(channelName);
  }
}

const startHub = async ({ port, configDir, verbose }) => {
  const hub = new Hub({configDir, verbose});

  hub.listen(port);
}

main();