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
        this._app.post('/feed/createFeed', async (req, res) => {
            try {
                await this._feedApiCreateFeed(req, res)
            }
            catch(err) {
                res.status(500).send('Error creating feed.');
            }
        });
        this._app.post('/feed/getFeedId', async (req, res) => {
            try {
                await this._feedApiGetFeedId(req, res)
            }
            catch(err) {
                res.status(500).send('Error getting feed id.');
            }
        });
        this._app.post('/feed/appendMessages', async (req, res) => {
            try {
                await this._feedApiAppendMessages(req, res)
            }
            catch(err) {
                console.warn(err);
                res.status(500).send('Error appending messages.');
            }
        });
        this._app.post('/feed/submitMessages', async (req, res) => {
            try {
                await this._feedApiSubmitMessages(req, res)
            }
            catch(err) {
                console.warn(err);
                res.status(500).send('Error appending messages.');
            }
        });
        this._app.post('/feed/getMessages', async (req, res) => {
            try {
                await this._feedApiGetMessages(req, res)
            }
            catch(err) {
                res.status(500).send('Error getting messages.');
            }
        });
        this._app.post('/feed/getSignedMessages', async (req, res) => {
            try {
                await this._feedApiGetSignedMessages(req, res)
            }
            catch(err) {
                res.status(500).send('Error getting signed messages.');
            }
        });
        this._app.post('/feed/getNumMessages', async (req, res) => {
            try {
                await this._feedApiGetNumMessages(req, res)
            }
            catch(err) {
                console.error(err);
                res.status(500).send('Error getting num. messages.');
            }
        });
        this._app.post('/feed/getFeedInfo', async (req, res) => {
            try {
                await this._feedApiGetFeedInfo(req, res)
            }
            catch(err) {
                console.error(err);
                res.status(500).send('Error getting feed info.');
            }
        });
        this._app.post('/feed/getSubfeedInfo', async (req, res) => {
            try {
                await this._feedApiGetSubfeedInfo(req, res)
            }
            catch(err) {
                console.error(err);
                res.status(500).send('Error getting subfeed info.');
            }
        });
        this._app.post('/feed/getAccessRules', async (req, res) => {
            try {
                await this._feedApiGetAccessRules(req, res)
            }
            catch(err) {
                console.error(err);
                res.status(500).send('Error getting access rules.');
            }
        });
        this._app.post('/feed/setAccessRules', async (req, res) => {
            try {
                await this._feedApiSetAccessRules(req, res)
            }
            catch(err) {
                console.error(err);
                res.status(500).send('Error setting access rules.');
            }
        });
    }
    async _apiProbe(req, res) {
        res.json({ success: true, nodeId: this._daemon.nodeId() });
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
    async _feedApiCreateFeed(req, res) {
        const reqData = req.body;
        const feedName = reqData.feedName || null;
        const feedId = await this._daemon.feedManager().createFeed({feedName});
        res.json({ success: true, feedId });
    }
    async _feedApiGetFeedId(req, res) {
        const reqData = req.body;
        const feedName = reqData.feedName;
        const feedId = await this._daemon.feedManager().getFeedId({feedName});
        if (!feedId) {
            res.json({ success: false });
            return;
        }
        res.json({ success: true, feedId });
    }
    async _feedApiAppendMessages(req, res) {
        const reqData = req.body;
        const {
            feedId, subfeedName, messages
        } = reqData;
        await this._daemon.feedManager().appendMessages({feedId, subfeedName, messages});
        res.json({ success: true })
    }
    async _feedApiSubmitMessages(req, res) {
        const reqData = req.body;
        const {
            feedId, subfeedName, messages
        } = reqData;
        await this._daemon.feedManager().submitMessages({feedId, subfeedName, messages});
        res.json({ success: true })
    }
    async _feedApiGetMessages(req, res) {
        const reqData = req.body;
        const {
            feedId, subfeedName, position, maxNumMessages, waitMsec
        } = reqData;
        const messages = await this._daemon.feedManager().getMessages({feedId, subfeedName, position, maxNumMessages, waitMsec});
        res.json({ success: true, messages });
    }
    async _feedApiGetSignedMessages(req, res) {
        const reqData = req.body;
        const {
            feedId, subfeedName, position, maxNumMessages, waitMsec
        } = reqData;
        const signedMessages = await this._daemon.feedManager().getSignedMessages({feedId, subfeedName, position, maxNumMessages, waitMsec});
        res.json({ success: true, signedMessages });
    }
    async _feedApiGetNumMessages(req, res) {
        const reqData = req.body;
        const {
            feedId, subfeedName
        } = reqData;
        const numMessages = await this._daemon.feedManager().getNumMessages({feedId, subfeedName});
        res.json({ success: true, numMessages });
    }
    async _feedApiGetFeedInfo(req, res) {
        const reqData = req.body;
        const {
            feedId
        } = reqData;
        const info = await this._daemon.feedManager().getFeedInfo({feedId});
        res.json({ success: true, info });
    }
    async _feedApiGetSubfeedInfo(req, res) {
        const reqData = req.body;
        const {
            feedId, subfeedName
        } = reqData;
        const info = await this._daemon.feedManager().getSubfeedInfo({feedId, subfeedName});
        res.json({ success: true, info });
    }
    async _feedApiGetAccessRules(req, res) {
        const reqData = req.body;
        const {
            feedId, subfeedName
        } = reqData;
        const rules = await this._daemon.feedManager().getAccessRules({feedId, subfeedName});
        res.json({ success: true, rules });
    }
    async _feedApiSetAccessRules(req, res) {
        const reqData = req.body;
        const {
            feedId, subfeedName, rules
        } = reqData;
        await this._daemon.feedManager().setAccessRules({feedId, subfeedName, rules});
        res.json({ success: true });
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
