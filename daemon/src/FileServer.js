import express from 'express';

class FileServer {
    constructor({verbose}) {
        this._verbose = verbose;
        this._app = null;
    }
    listen(port) {
        this._app = express();
        this._app.set('port', port);

        const sha1Dir = `${process.env.KACHERY_STORAGE_DIR}/sha1`;
        this._app.use('/sha1', (req, res, next) => {
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
            console.log(`File request: /sha1${relpath}`);
            next();
        })
        this._app.use('/sha1', express.static(sha1Dir));

        const feedsDir = `${process.env.KACHERY_STORAGE_DIR}/feeds`;
        this._app.use('/feeds', (req, res, next) => {
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
        })
        this._app.use('/feeds', express.static(feedsDir));

        this._app.listen(this._app.get('port'), function() {
            console.info(`Serving files on port ${port}`);
        });
    }
}

export default FileServer;