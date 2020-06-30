#!/usr/bin/env node

import yargs from 'yargs';
import Daemon from './Daemon.js';
import ApiServer from './ApiServer.js';

function main() {
  const argv = yargs
    .scriptName('kachery-p2p-daemon')
    .command({
      command: 'start',
      desc: 'Start the daemon',
      builder: (yargs) => {
        yargs.option('network', {
          describe: 'Name of kachery-p2p network to join',
          type: 'array',
        })
        yargs.option('verbose', {
          describe: 'Verbosity level.',
          type: 'number',
          default: 0
        })
      },
      handler: (argv) => {
        let networkNames = argv.network || [];
        if (networkNames.length === 0) {
          console.warn('WARNING: no networks specified. Use --network [network-name].');
        }
        startDaemon({ networkNames, verbose: argv.verbose });
      }
    })
    .demandCommand()
    .strict()
    .help()
    .wrap(72)
    .argv
}

const apiPort = process.env.API_PORT || 20431;

const startDaemon = async ({ networkNames, verbose }) => {
  const daemon = new Daemon({verbose});

  const apiServer = new ApiServer(daemon);
  apiServer.listen(apiPort);

  for (let networkName of networkNames) {
    await daemon.joinNetwork(networkName);
  }
}

main();