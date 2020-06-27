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
        yargs.option('swarm', {
          describe: 'Name of swarm to join',
          type: 'array',
        })
        yargs.option('verbose', {
          describe: 'Verbosity level.',
          type: 'number',
          default: 0
        })
      },
      handler: (argv) => {
        let swarmNames = argv.swarm || [];
        if (swarmNames.length === 0) {
          console.warn('WARNING: no swarms specified. Use --swarm [swarm-name].');
        }
        startDaemon({ swarmNames, verbose: argv.verbose });
      }
    })
    .command({
      command: 'get-all',
      desc: 'Get information about the running daemon',
      // builder: (yargs) => yargs.option('test'),
      handler: (argv) => {
        displayAll();
      }
    })
    .command({
      command: 'get-swarms',
      desc: 'View the swarms joined by the running daemon',
      // builder: (yargs) => yargs.option('test'),
      handler: (argv) => {
        displaySwarms();
      }
    })
    .command({
      command: 'get-peers',
      desc: 'View the peers of the running daemon',
      // builder: (yargs) => yargs.option('test'),
      handler: (argv) => {
        displayPeers();
      }
    })
    .command({
      command: 'join-swarm <swarmName>',
      desc: 'Join the swarm with given name',
      handler: (argv) => {
        joinSwarm(argv.swarmName);
      }
    })
    .command({
      command: 'request-file <kacheryPath>',
      desc: 'Request a file from the swarms that have been joined',
      handler: (argv) => {
        requestFile(argv.kacheryPath);
      }
    })
    .demandCommand()
    .strict()
    .help()
    .wrap(72)
    .argv
}

const apiPort = process.env.API_PORT || 20431;

const startDaemon = async ({ swarmNames, verbose }) => {
  const daemon = new Daemon({verbose});

  const apiServer = new ApiServer(daemon);
  apiServer.listen(apiPort);

  for (let swarmName of swarmNames) {
    await daemon.joinSwarm(swarmName);
  }
}

// const displayAll = async () => {
//   const url = `http://localhost:${apiPort}/getState`;
//   const state = (await axios.post(url)).data.state;
//   console.info(JSON.stringify(state, null, 4));
// }

// const displaySwarms = async () => {
//   const url = `http://localhost:${apiPort}/getState`;
//   const state = (await axios.post(url)).data.state;
//   console.info('SWARMS:');
//   for (let swarm of (state.swarms || [])) {
//     console.info(swarm.swarmName);
//   }
// }

// const displayPeers = async () => {
//   const url = `http://localhost:${apiPort}/getState`;
//   const state = (await axios.post(url)).data.state;
//   console.info('PEERS:')
//   for (let peer of (state.peers || [])) {
//     displayPeer(peer);
//   }
// }

// const displayPeer = peer => {
//   const connectionInfo = peer.connectionInfo;
//   console.info(`${peer.swarmName} ${peer.peerId} ${connectionInfo.host}:${connectionInfo.port}${connectionInfo.local ? " (local)" : ""}`)
// }

// const joinSwarm = async (swarmName) => {
//   const url = `http://localhost:${apiPort}/joinSwarm`;
//   const response = (await axios.post(url, {swarmName})).data;
// }

// const requestFile = async (kacheryPath) => {
//   const url = `http://localhost:${apiPort}/requestFile`;
//   const response = (await axios.post(url, {kacheryPath: kacheryPath, opts: {}})).data;
//   await displayAll();
// }

main();