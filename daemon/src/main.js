import { kacheryInfo } from './kachery.js';
import Daemon from './Daemon.js';
import { sleepMsec } from './util.js';
import ApiServer from './apiserver.js';

const main = async () => {
    const daemon = new Daemon();

    const apiServer = new ApiServer(daemon);
    apiServer.listen(process.env.API_PORT || 20431);

    await daemon.joinSwarm('jfm-test');

    daemon.requestFile('jfm-test', 'sha1://c63bc42eb07b119735116c51206d8a4d9e405e74/package.json');

    while (true) {
        let x = daemon.getIncomingFileRequests();
        await sleepMsec(1000);
    }
}

main();