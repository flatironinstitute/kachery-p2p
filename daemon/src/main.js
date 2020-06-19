import { kacheryInfo } from './kachery.js';
import Daemon from './Daemon.js';

const main = async () => {
    const daemon = new Daemon();

    await daemon.joinSwarm('jfm-test');
}

main();