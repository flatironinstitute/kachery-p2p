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

        this._app.use('/sha1', (req, res, next) => {
            (async () => {
                const query = req.query;
                const list = req.url.split('?')[0].split('/');
                const expectedLengths = [0, 40];
                if (list.length !== expectedLengths.length) {
                    return res.status(403).end('403 Forbidden');
                }
                for (let i=0; i<expectedLengths.length; i++) {
                    if (list[i].length !== expectedLengths[i]) {
                        return res.status(403).end('403 Forbidden');
                    }
                }
                const sha1 = list[1];
                const relpath = `sha1/${sha1[0]}${sha1[1]}/${sha1[2]}${sha1[3]}/${sha1[4]}${sha1[5]}/${sha1}`;
                if (!fs.existsSync(`${process.env.KACHERY_STORAGE_DIR}/${relpath}`)) {
                    console.info(`Request: sha1://${sha1}`, query);
                    const fileKey = {
                        sha1
                    };
                    if (query.chunkOf) {
                        const list = query.chunkOf.split('~');
                        if (list.length === 3) {
                            const chunkOfSha1 = list[0];
                            const startByte = Number(list[1]);
                            const endByte = Number(list[2]);
                            fileKey.chunkOf = {
                                fileKey: {
                                    sha1: chunkOfSha1
                                },
                                startByte,
                                endByte
                            }
                            const cs = chunkOfSha1;
                            const chunkOfRelPath = `sha1/${cs[0]}${cs[1]}/${cs[2]}${cs[3]}/${cs[4]}${cs[5]}/${cs}`;
                            if (fs.existsSync(`${process.env.KACHERY_STORAGE_DIR}/${chunkOfRelPath}`)) {
                                req.headers['Range'] = `bytes=${startByte}-${endByte - 1}`;
                                res.sendFile(chunkOfRelPath, {
                                    root: process.env.KACHERY_STORAGE_DIR,
                                    acceptRanges: true
                                });
                                return;
                            }
                        }
                    }
                    validateObject(fileKey, '/FileKey');
                    const opts = {};
                    const x = this._daemon.loadFile({fileKey, opts});
                    let done = false;
                    x.onFinished(() => {
                        if (done) return;
                        done =true;
                        console.info(`Found file on p2p network: sha1://${sha1}`);
                        res.sendFile(`${relpath}`, {
                            root: process.env.KACHERY_STORAGE_DIR,
                            acceptRanges: false
                        });
                    });
                    x.onError((err) => {
                        if (done) return;
                        done =true;
                        console.info(`Unable to find file on p2p network: sha1://${sha1} (${err.message})`);
                        res.status(404).end('404 Not found');
                    });
                    x.onProgress((prog) => {});
                    req.on('close', () => {
                        if (done) return;
                        // if the request socket is closed, we cancel the load request
                        console.info(`Cancelling request for file: sha1://${sha1}`);
                        x.cancel();
                    });
                }
                else {
                    console.log(`Serving: sha1://${sha1}`);
                    res.sendFile(relpath, {root: process.env.KACHERY_STORAGE_DIR})
                }
            })();
        })
        // this._app.use('/sha1', express.static(sha1Dir));

        // const feedsDir = `${process.env.KACHERY_STORAGE_DIR}/feeds`;
        // this._app.use('/feeds', (req, res, next) => {
        //     (async () => {
        //         const relpath = req.url;
        //         const list = relpath.split('/');
        //         const expectedLengths = [0, 2, 2, 2, 64, 'subfeeds'.length, 2, 2, 2, 40, 'messages'.length];
        //         if (list.length !== expectedLengths.length) {
        //             return res.status(403).end('403 Forbidden');
        //         }
        //         for (let i=0; i<expectedLengths.length; i++) {
        //             if (list[i].length !== expectedLengths[i]) {
        //                 return res.status(403).end('403 Forbidden');
        //             }
        //         }
        //         if (list[1] + list[2] + list[3] !== list[4].slice(0, 6)) {
        //             return res.status(403).end('403 Forbidden');
        //         }
        //         if (list[5] !== 'subfeeds') {
        //             return res.status(403).end('403 Forbidden');
        //         }
        //         if (list[6] + list[7] + list[8] !== list[9].slice(0, 6)) {
        //             return res.status(403).end('403 Forbidden');
        //         }
        //         if (list[10] !== 'messages') {
        //             return res.status(403).end('403 Forbidden');
        //         }
        //         console.log(`File request: /feeds${relpath}`);
        //         next();
        //     })();
        // })
        // this._app.use('/feeds', express.static(feedsDir));

        this._app.listen(this._app.get('port'), function() {
            console.info(`Serving files on port ${port}`);
        });
    }
}

export default FileServer;