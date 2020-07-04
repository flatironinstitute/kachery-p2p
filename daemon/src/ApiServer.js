import express from 'express';
import https from 'https';
import http from 'http';
import fs from 'fs';
import JsonSocket from 'json-socket';
import { sleepMsec } from './util.js';

export default class ApiServer {
    constructor(daemon) {
        this._daemon = daemon;

        this._app = express(); // the express app

        this._app.set('json spaces', 4); // when we respond with json, this is how it will be formatted
        // this._app.use(cors()); // in the future, if we want to do this
        this._app.use(express.json());

        this._app.get('/probe', async (req, res) => {
            await waitMsec(100);
            try {
                await this._apiProbe(req, res) 
            }
            catch(err) {
                await this._errorResponse(req, res, 500, err.message);
            }
        });
        this._app.get('/halt', async (req, res) => {
            await waitMsec(100);
            try {
                await this._apiHalt(req, res)
                await sleepMsec(1000);
                process.exit(0);
            }
            catch(err) {
                await this._errorResponse(req, res, 500, err.message);
            }
        });
        this._app.post('/getState', async (req, res) => {
            try {
                await this._apiGetState(req, res)
            }
            catch(err) {
                await this._errorResponse(req, res, 500, err.message);
            }
        });
        this._app.post('/joinChannel', async (req, res) => {
            try {
                await this._apiJoinChannel(req, res)
            }
            catch(err) {
                await this._errorResponse(req, res, 500, err.message);
            }
        });
        this._app.post('/leaveChannel', async (req, res) => {
            try {
                await this._apiLeaveChannel(req, res)
            }
            catch(err) {
                await this._errorResponse(req, res, 500, err.message);
            }
        });
        this._app.post('/findFile', async (req, res) => {
            try {
                await this._apiFindFile(req, res)
            }
            catch(err) {
                await this._errorResponse(req, res, 500, err.message);
            }
        });
        this._app.post('/downloadFile', async (req, res) => {
            try {
                await this._apiDownloadFile(req, res)
            }
            catch(err) {
                res.status(500).send('Error downloading file.');
            }
        });
    }
    async _apiProbe(req, res) {
        res.json({ success: true });
    }
    async _apiHalt(req, res) {
        await this._daemon.halt();
        res.json({ success: true });
    }
    async _apiGetState(req, res) {
        const state = this._daemon.getState();
        res.json({ success: true, state });
    }
    async _apiJoinChannel(req, res) {
        const reqData = req.body;
        const channelName = reqData.channelName;
        await this._daemon.joinChannel(channelName);
        res.json({ success: true });
    }
    async _apiLeaveChannel(req, res) {
        const reqData = req.body;
        const channelName = reqData.channelName;
        await this._daemon.leaveChannel(channelName);
        res.json({ success: true });
    }
    async _apiFindFile(req, res) {
        const reqData = req.body;
        const x = this._daemon.findFile({fileKey: reqData.fileKey, timeoutMsec: reqData.timeoutMsec});
        const jsonSocket = new JsonSocket(res);
        x.onFound(result => {
            jsonSocket.sendMessage(result);
        });
        x.onFinished(() => {
            res.end();
        })
        req.on('close', () => {
            x.cancel();
        });
    }
    async _apiDownloadFile(req, res) {
        const reqData = req.body;
        const {stream, cancel} = await this._daemon.downloadFile({primaryNodeId: reqData.primaryNodeId, swarmName: reqData.swarmName, fileKey: reqData.fileKey, fileSize: reqData.fileSize, opts: reqData.opts || {}});
        // todo: cancel on connection closed
        stream.pipe(res);
    }
    async _errorResponse(req, res, code, errstr) {
        console.info(`Responding with error: ${code} ${errstr}`);
        try {
            res.status(code).send(errstr);
        }
        catch(err) {
            console.warn(`Problem sending error: ${err.message}`);
        }
        await waitMsec(100);
        try {
            req.connection.destroy();
        }
        catch(err) {
            console.warn(`Problem destroying connection: ${err.message}`);
        }
    }
    async listen(port) {
        await start_http_server(this._app, port);
    }
}

function waitMsec(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function start_http_server(app, listen_port) {
    app.port = listen_port;
    if (process.env.SSL != null ? process.env.SSL : listen_port % 1000 == 443) {
        // The port number ends with 443, so we are using https
        app.USING_HTTPS = true;
        app.protocol = 'https';
        // Look for the credentials inside the encryption directory
        // You can generate these for free using the tools of letsencrypt.org
        const options = {
            key: fs.readFileSync(__dirname + '/encryption/privkey.pem'),
            cert: fs.readFileSync(__dirname + '/encryption/fullchain.pem'),
            ca: fs.readFileSync(__dirname + '/encryption/chain.pem')
        };

        // Create the https server
        app.server = https.createServer(options, app);
    } else {
        app.protocol = 'http';
        // Create the http server and start listening
        app.server = http.createServer(app);
    }
    await app.server.listen(listen_port);
    console.info(`API server is running ${app.protocol} on port ${app.port}`);
}
