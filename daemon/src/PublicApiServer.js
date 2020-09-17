import express from 'express';
import https from 'https';
import http from 'http';
import fs from 'fs';
import JsonSocket from 'json-socket';
import { sleepMsec } from './common/util.js';
import { log } from './common/log.js';
import { validateChannelName, validateObject, validateNodeId } from './schema/index.js';
import { assert } from 'console';
import start_http_server from './common/start_http_server.js';

export default class PublicApiServer {
    // This is the public API server for communication between nodes
    constructor(daemon) {
        this._daemon = daemon; // The kachery-p2p daemon

        this._stopper_callbacks = [];

        this._app = express(); // the express app

        this._app.set('json spaces', 4); // when we respond with json, this is how it will be formatted
        // this._app.use(cors()); // in the future, if we want to do this
        this._app.use(express.json());

        this._app.all('/*', (req, res, next) => {
            next();
        });

        // /probe - check whether the daemon is up and running and return info such as the node ID
        this._app.get('/probe', async (req, res) => {
            log().info('/probe');
            try {
                await this._apiProbe(req, res) 
            }
            catch(err) {
                await this._errorResponse(req, res, 500, err.message);
            }
        });
        // /getState - return the state of the daemon, with information about the channels and peers
        this._app.post('/getChannelInfo', async (req, res) => {
            log().info('/getChannelInfo');
            try {
                await this._apiGetChannelInfo(req, res)
            }
            catch(err) {
                await this._errorResponse(req, res, 500, err.message);
            }
        });
    }
    // /probe - check whether the daemon is up and running and return info such as the node ID
    async _apiProbe(req, res) {
        res.json({ success: true, nodeId: this._daemon.nodeId() });
    }
    // /getState - return the state of the daemon, with information about the channels and peers
    async _apiGetChannelInfo(req, res) {
        const reqBody = req.body;
        validateObject(reqBody, '/PublicRequestGetChannelInfo');
        res.json({ success: false, error: 'Not yet implemented' });
    }
    // Start listening via http/https
    async listen(port) {
        await start_http_server(this._app, port, stopper);
    }
}