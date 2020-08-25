import express from 'express';
import fs from 'fs';
import { validateObject } from './schema/index.js';

class FileServer {
    constructor({daemon, verbose}) {
        this._daemon = daemon;
        this._verbose = verbose;
        this._app = null;
    }
    listen(port) {
        this._app = express();
        this._app.set('port', port);

        const sha1Dir = `${process.env.KACHERY_STORAGE_DIR}/sha1`;
        this._app.use('/sha1', (req, res, next) => {
            (async () => {
                const query = req.query;
                const relpath = req.url;
                const list = relpath.split('/');
                const expectedLengths = [0, 2, 2, 2, 40];
                if (list.length !== expectedLengths.length) {
                    return res.status(403).end('403 Forbidden');
                }
                for (let i=0; i<expectedLengths.length; i++) {
                    if (list[i].length !== expectedLengths[i]) {
                        return res.status(403).end('403 Forbidden');
                    }
                }
                if (list[1] + list[2] + list[3] !== list[4].slice(0, 6)) {
                    return res.status(403).end('403 Forbidden');
                }
                if (!fs.existsSync(`${process.env.KACHERY_STORAGE_DIR}/sha1${relpath}`)) {
                    console.log(`Request: /sha1${relpath}`);
                    const fileKey = {
                        sha1: list[4]
                    };
                    if (query.chunkOf) {
                        const list = query.chunkOf.split('~');
                        if (list.length === 3) {
                            const chunkOfSha1 = list[0];
                            const startByte = Number(list[1]);
                            const endByte = Number(list[2]);
                            fileKey.chunkOf = {
                                fileKey: {
                                    sha1: chunkOfSha1,
                                    startByte,
                                    endByte
                                }
                            }
                            const cs = chunkOfSha1;
                            const chunkOfRelPath = `/${cs[0]}${cs[1]}/${cs[2]}${cs[3]}/${cs[4]}${cs[5]}/${cs}`;
                            const chunkOfPath = `${process.env.KACHERY_STORAGE_DIR}/sha1${chunkOfRelPath}`;
                            if (fs.existsSync(chunkOfPath)) {
                                req.url = chunkOfRelPath;
                                req.headers['Range'] = `bytes=${startByte}-${endByte - 1}`;
                                next();
                                return;
                            }
                        }
                    }
                    validateObject(fileKey, '/FileKey');
                    const opts = {}
                    const x = this._daemon.loadFile({fileKey, opts});
                    await new Promise((resolve, reject) => {
                        x.onFinished(() => {
                            console.info(`Found file on p2p network: /sha1${relpath}`);
                            resolve();
                        });
                        x.onError((err) => {
                            console.info(`Unable to find file on p2p network: /sha1${relpath} (${err.message})`);
                            resolve();
                        });
                        x.onProgress((prog) => {});
                    });
                }
                else {
                    console.log(`Serving: /sha1${relpath}`);
                }
                next();
            })();
        })
        this._app.use('/sha1', express.static(sha1Dir));

        const feedsDir = `${process.env.KACHERY_STORAGE_DIR}/feeds`;
        this._app.use('/feeds', (req, res, next) => {
            (async () => {
                const relpath = req.url;
                const list = relpath.split('/');
                const expectedLengths = [0, 2, 2, 2, 64, 'subfeeds'.length, 2, 2, 2, 40, 'messages'.length];
                if (list.length !== expectedLengths.length) {
                    return res.status(403).end('403 Forbidden');
                }
                for (let i=0; i<expectedLengths.length; i++) {
                    if (list[i].length !== expectedLengths[i]) {
                        return res.status(403).end('403 Forbidden');
                    }
                }
                if (list[1] + list[2] + list[3] !== list[4].slice(0, 6)) {
                    return res.status(403).end('403 Forbidden');
                }
                if (list[5] !== 'subfeeds') {
                    return res.status(403).end('403 Forbidden');
                }
                if (list[6] + list[7] + list[8] !== list[9].slice(0, 6)) {
                    return res.status(403).end('403 Forbidden');
                }
                if (list[10] !== 'messages') {
                    return res.status(403).end('403 Forbidden');
                }
                console.log(`File request: /feeds${relpath}`);
                next();
            })();
        })
        this._app.use('/feeds', express.static(feedsDir));

        this._app.listen(this._app.get('port'), function() {
            console.info(`Serving files on port ${port}`);
        });
    }
}

export default FileServer;