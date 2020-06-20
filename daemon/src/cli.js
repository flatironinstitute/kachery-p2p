#!/usr/bin/env node

import yargs from 'yargs';
import Daemon from './Daemon.js';
import { sleepMsec } from './util.js';
import ApiServer from './ApiServer.js';
import axios from 'axios';

function main() {
  const argv = yargs
    .scriptName('kachery-p2p-daemon')
    .command({
      command: 'start',
      desc: 'Start the daemon',
      handler: (argv) => {
        startDaemon();
      }
    })
    .command({
      command: 'info',
      desc: 'Get information about the running daemon',
      // builder: (yargs) => yargs.option('test'),
      handler: (argv) => {
        displayInfo();
      }
    })
    .demandCommand()
    .help()
    .wrap(72)
    .argv
}

const apiPort = process.env.API_PORT || 20431;

const startDaemon = async () => {
  const daemon = new Daemon();

  const apiServer = new ApiServer(daemon);
  apiServer.listen(apiPort);

  await daemon.joinSwarm('jfm-test');

  daemon.requestFile('jfm-test', 'sha1://c63bc42eb07b119735116c51206d8a4d9e405e74/package.json');

  while (true) {
    let x = daemon.getIncomingFileRequests();
    await sleepMsec(1000);
  }
}

const displayInfo = async () => {
  const url = `http://localhost:${apiPort}/getState`;
  const state = (await axios.get(url)).data;
  console.info(JSON.stringify(state, null, 4));
}

main();