import express, { Express } from 'express';
import JsonSocket from 'json-socket';
import { sleepMsec } from './common/util';
import { validateChannelName, validateObject, validateNodeId } from './schema/index.js';
import { assert } from 'console';
import start_http_server from './common/start_http_server.js';
import KacheryP2PNode from './KacheryP2PNode';
import { ChannelName, FileKey, isSubfeedWatches, NodeId, isNumber } from './interfaces';
import { access } from 'fs';

export default class DaemonApiServer {
    _node: KacheryP2PNode
    _stopper_callbacks: (() => void)[]
    _app: Express

    // This is the API server for the local daemon
    // The local Python code communicates with the daemon
    // via this API
    constructor(node: KacheryP2PNode, {verbose}) {
        this._node = node; // The kachery-p2p daemon
        this._stopper_callbacks = [];
        this._app = express(); // the express app

        this._app.set('json spaces', 4); // when we respond with json, this is how it will be formatted
        // this._app.use(cors()); // in the future, if we want to do this
        this._app.use(express.json());

        this._app.all('/*', (req, res, next) => {
            if (!isLocalRequest(req)) {
                console.warn(`Rejecting access to remote request from ${req.connection.remoteAddress}`);
                res.send("API only accessible from the local device").status(403).end();
                return;
            }
            next();
        });

        // /probe - check whether the daemon is up and running and return info such as the node ID
        this._app.get('/probe', async (req, res) => {
            console.info('/probe');
            try {
                await this._apiProbe(req, res) 
            }
            catch(err) {
                await this._errorResponse(req, res, 500, err.message);
            }
        });
        // /halt - halt the kachery-p2p daemon (stops the server process)
        this._app.get('/halt', async (req, res) => {
            console.info('/halt');
            await sleepMsec(100);
            try {
                await this._apiHalt(req, res)
                await sleepMsec(1000);
                process.exit(0);
            }
            catch(err) {
                await this._errorResponse(req, res, 500, err.message);
            }
        });
        // /findFile - find a file (or feed) in the remote nodes. May return more than one.
        this._app.post('/findFile', async (req, res) => {
            console.info('/findFile');
            try {
                await this._apiFindFile(req, res)
            }
            catch(err) {
                await this._errorResponse(req, res, 500, err.message);
            }
        });
        // /loadFile - download file from remote node(s) and store in kachery storage
        this._app.post('/loadFile', async (req, res) => {
            console.info('/loadFile');
            try {
                await this._apiLoadFile(req, res)
            }
            catch(err) {
                console.warn(err.stack);
                res.status(500).send('Error loading file.');
            }
        });
        // /feed/createFeed - create a new writeable feed on this node
        this._app.post('/feed/createFeed', async (req, res) => {
            console.info('/feed/createFeed');
            try {
                await this._feedApiCreateFeed(req, res)
            }
            catch(err) {
                res.status(500).send('Error creating feed.');
            }
        });
        // /feed/deleteFeed - delete feed on this node
        this._app.post('/feed/deleteFeed', async (req, res) => {
            console.info('/feed/deleteFeed');
            try {
                await this._feedApiDeleteFeed(req, res)
            }
            catch(err) {
                res.status(500).send(`Error deleting feed: ${err.message}`);
            }
        });
        // /feed/getFeedId - lookup the ID of a local feed based on its name
        this._app.post('/feed/getFeedId', async (req, res) => {
            console.info('/feed/getFeedId');
            try {
                await this._feedApiGetFeedId(req, res)
            }
            catch(err) {
                res.status(500).send('Error getting feed id.');
            }
        });
        // /feed/appendMessages - append messages to a local writeable subfeed
        this._app.post('/feed/appendMessages', async (req, res) => {
            console.info('/feed/appendMessages', req.body.messages.map(msg => (msg.type)));
            try {
                await this._feedApiAppendMessages(req, res)
            }
            catch(err) {
                console.warn('Error in appendMessages', {error: err.message});
                res.status(500).send('Error appending messages.');
            }
        });
        // /feed/submitMessages - submit messages to a remote live subfeed (must have permission)
        this._app.post('/feed/submitMessages', async (req, res) => {
            console.info('/feed/submitMessages');
            try {
                await this._feedApiSubmitMessages(req, res)
            }
            catch(err) {
                console.warn('Error in submitMessages', {error: err.message});
                res.status(500).send(`Error appending messages: ${err.message}`);
            }
        });
        // /feed/getMessages - get messages from a local or remote subfeed
        this._app.post('/feed/getMessages', async (req, res) => {
            // important not to log this because then we'll have a feedback loop if we are listening to the log by getting the messages!
            // console.info('/feed/getMessages');
            try {
                await this._feedApiGetMessages(req, res)
            }
            catch(err) {
                console.warn('Error in getMessages', {error: err.message});
                res.status(500).send('Error getting messages.');
            }
        });
        // /feed/getSignedMessages - get signed messages from a local or remote subfeed
        this._app.post('/feed/getSignedMessages', async (req, res) => {
            console.info('/feed/getSignedMessages');
            try {
                await this._feedApiGetSignedMessages(req, res)
            }
            catch(err) {
                console.warn('Error in getSignedMessages', {error: err.message});
                res.status(500).send('Error getting signed messages.');
            }
        });
        // /feed/getNumMessages - get number of messages in a subfeed
        this._app.post('/feed/getNumMessages', async (req, res) => {
            console.info('/feed/getNumMessages');
            try {
                await this._feedApiGetNumMessages(req, res)
            }
            catch(err) {
                console.warn('Error in getNumMessages', {error: err.message});
                res.status(500).send('Error getting num. messages.');
            }
        });
        // /feed/getFeedInfo - get info for a feed - such as whether it is writeable
        this._app.post('/feed/getFeedInfo', async (req, res) => {
            console.info('/feed/getFeedInfo');
            try {
                await this._feedApiGetFeedInfo(req, res)
            }
            catch(err) {
                console.warn(err.stack);
                console.warn('Error in getFeedInfo', {error: err.message});
                res.status(500).send('Error getting feed info.');
            }
        });
        // /feed/getAccessRules - get access rules for a local writeable subfeed
        this._app.post('/feed/getAccessRules', async (req, res) => {
            console.info('/feed/getAccessRules');
            try {
                await this._feedApiGetAccessRules(req, res)
            }
            catch(err) {
                console.warn('Error in getAccessRules', {error: err.message});
                res.status(500).send('Error getting access rules.');
            }
        });
        // /feed/setAccessRules - set access rules for a local writeable subfeed
        this._app.post('/feed/setAccessRules', async (req, res) => {
            console.info('/feed/setAccessRules');
            try {
                await this._feedApiSetAccessRules(req, res)
            }
            catch(err) {
                console.warn('Error in setAccessRules', {error: err.message});
                res.status(500).send('Error setting access rules.');
            }
        });
        // /feed/watchForNewMessages - wait until new messages have been appended to a list of watched subfeeds
        this._app.post('/feed/watchForNewMessages', async (req, res) => {
            console.info('/feed/watchForNewMessages', req.body.subfeedWatches);
            try {
                await this._feedApiWatchForNewMessages(req, res)
            }
            catch(err) {
                console.warn('Error in watchForNewMessages', {error: err.message});
                res.status(500).send('Error watching for new messages.');
            }
        });
    }
    // /probe - check whether the daemon is up and running and return info such as the node ID
    async _apiProbe(req, res) {
        res.json({ success: true, nodeId: this._node.nodeId() });
    }
    // /halt - halt the kachery-p2p daemon (stops the server process)
    async _apiHalt(req, res) {
        await this._node.halt();
        this._stopper_callbacks.forEach(cb => {cb();});
        res.json({ success: true });
    }
    // /findFile - find a file (or feed) in the remote nodes. May return more than one.
    async _apiFindFile(req, res) {
        const reqData = req.body;
        // Returns the find request
        validateObject(reqData.fileKey, '/FileKey');
        if (reqData.timeoutMsec !== undefined) {
            assert(typeof(reqData.timeoutMsec) === 'number', 'apiFindFile: timeoutMsec is not a number');
        }
        const fileKey: FileKey = reqData.fileKey as FileKey
        const timeoutMsec: number | undefined = reqData.timeoutMsec;
        const x = this._node.findFile({fileKey, timeoutMsec});
        const jsonSocket = new JsonSocket(res);
        let isDone = false;
        x.onFound(result => {
            if (isDone) return;
            validateObject(result, '/FindFileOrLiveFeedResult');
            // may return more than one result
            // we send them one-by-one
            jsonSocket.sendMessage(result);
        });
        x.onFinished(() => {
            if (isDone) return;
            // we are done
            isDone = true;
            res.end();
        })
        req.on('close', () => {
            // if the request socket is closed, we cancel the find request
            isDone = true;
            x.cancel();
        });
    }
    // /loadFile - load a file from remote kachery node(s) and store in kachery storage
    async _apiLoadFile(req, res) {
        const reqData = req.body;
        validateObject(reqData.fileKey, '/FileKey');
        const opts: {fromNode: NodeId | undefined, fromChannel: ChannelName | undefined} = {fromNode: undefined, fromChannel: undefined};
        if (reqData.fromNode) {
            validateNodeId(reqData.fromNode);
            opts.fromNode = reqData.fromNode;
        }
        if (reqData.fromChannel) {
            validateChannelName(reqData.fromChannel);
            opts.fromChannel = reqData.fromChannel;
        }
        const x = this._node.loadFile({
            fileKey: reqData.fileKey,
            opts
        });
        const jsonSocket = new JsonSocket(res);
        let isDone = false;
        // todo: track progress
        x.onFinished(() => {
            if (isDone) return;
            // we are done
            isDone = true;
            jsonSocket.sendMessage({type: 'finished'});
            res.end();
        });
        x.onError((err) => {
            if (isDone) return;
            isDone = true;
            jsonSocket.sendMessage({type: 'error', error: err.message});
            res.end();
        });
        x.onProgress((prog) => {
            jsonSocket.sendMessage({
                type: 'progress',
                bytesLoaded: prog.bytesLoaded,
                bytesTotal: prog.bytesTotal,
                nodeId: prog.nodeId || ''
            });
        });
        req.on('close', () => {
            // if the request socket is closed, we cancel the load request
            isDone = true;
            x.cancel();
        });
    }
    // /feed/createFeed - create a new writeable feed on this node
    async _feedApiCreateFeed(req, res) {
        const reqData = req.body;
        const feedName = reqData.feedName || null;
        if (feedName) {
            assert(typeof(feedName) === 'string', 'feedName is not a string');
        }
        const feedId = await this._node.feedManager().createFeed({feedName});
        res.json({ success: true, feedId });
    }
    // /feed/deleteFeed - delete feed on this node
    async _feedApiDeleteFeed(req, res) {
        const reqData = req.body;
        const feedId = reqData.feedId || null;
        if (feedId) {
            validateObject(feedId, '/FeedId');
        }
        await this._node.feedManager().deleteFeed({feedId});
        res.json({ success: true });
    }
    // /feed/getFeedId - lookup the ID of a local feed based on its name
    async _feedApiGetFeedId(req, res) {
        const reqData = req.body;
        const feedName = reqData.feedName;
        assert(typeof(feedName) === 'string', 'feedName is not a string');
        const feedId = await this._node.feedManager().getFeedId({feedName});
        if (!feedId) {
            res.json({ success: false });
            return;
        }
        res.json({ success: true, feedId });
    }
    // /feed/appendMessages - append messages to a local writeable subfeed
    async _feedApiAppendMessages(req, res) {
        const reqData = req.body;
        const {
            feedId, subfeedHash, messages
        } = reqData;
        validateObject(feedId, '/FeedId');
        validateObject(subfeedHash, '/SubfeedHash');
        assert(Array.isArray(messages), 'messages is not an array');
        await this._node.feedManager().appendMessages({
            feedId, subfeedHash, messages
        });
        res.json({ success: true })
    }
    // /feed/submitMessages - submit messages to a remote live subfeed (must have permission)
    async _feedApiSubmitMessages(req, res) {
        const reqData = req.body;
        const {
            feedId, subfeedHash, messages, timeoutMsec
        } = reqData;
        validateObject(feedId, '/FeedId');
        validateObject(subfeedHash, '/SubfeedHash');
        assert(Array.isArray(messages), 'messages is not an array');
        await this._node.feedManager().submitMessages({feedId, subfeedHash, messages, timeoutMsec});
        res.json({ success: true })
    }
    // /feed/getMessages - get messages from a local or remote subfeed
    async _feedApiGetMessages(req, res) {
        const reqData = req.body;
        const {
            feedId, subfeedHash, position, maxNumMessages, waitMsec
        } = reqData;
        validateObject(feedId, '/FeedId');
        validateObject(subfeedHash, '/SubfeedHash');
        // assert(typeof(position) === 'number');
        // assert(typeof(maxNumMessages) === 'number');
        // assert(typeof(waitMsec) === 'number');
        const messages = await this._node.feedManager().getMessages({
            feedId, subfeedHash, position, maxNumMessages, waitMsec
        });
        res.json({ success: true, messages });
    }
    // /feed/getSignedMessages - get signed messages from a local or remote subfeed
    async _feedApiGetSignedMessages(req, res) {
        const reqData = req.body;
        const {
            feedId, subfeedHash, position, maxNumMessages, waitMsec
        } = reqData;
        validateObject(feedId, '/FeedId');
        validateObject(subfeedHash, '/SubfeedHash');
        // assert(typeof(position) === 'number');
        // assert(typeof(maxNumMessages) === 'number');
        // assert(typeof(waitMsec) === 'number');
        const signedMessages = await this._node.feedManager().getSignedMessages({
            feedId, subfeedHash, position, maxNumMessages, waitMsec
        });
        res.json({ success: true, signedMessages });
    }
    // /feed/getNumMessages - get number of messages in a subfeed
    async _feedApiGetNumMessages(req, res) {
        const reqData = req.body;
        const {
            feedId, subfeedHash
        } = reqData;
        validateObject(feedId, '/FeedId');
        validateObject(subfeedHash, '/SubfeedHash');
        const numMessages = await this._node.feedManager().getNumMessages({
            feedId, subfeedHash
        });
        res.json({ success: true, numMessages });
    }
    // /feed/getFeedInfo - get info for a feed - such as whether it is writeable
    async _feedApiGetFeedInfo(req, res) {
        const reqData = req.body;
        const {
            feedId,
            timeoutMsec
        } = reqData;
        validateObject(feedId, '/FeedId');
        const info = await this._node.feedManager().getFeedInfo({feedId, timeoutMsec});
        res.json({ success: true, info });
    }
    // /feed/getAccessRules - get access rules for a local writeable subfeed
    async _feedApiGetAccessRules(req, res) {
        const reqData = req.body;
        const {
            feedId, subfeedHash
        } = reqData;
        validateObject(feedId, '/FeedId');
        validateObject(subfeedHash, '/SubfeedHash');
        const accessRules = await this._node.feedManager().getAccessRules({feedId, subfeedHash});
        validateObject(accessRules, '/AccessRules');
        res.json({ success: true, accessRules });
    }
    // /feed/setAccessRules - set access rules for a local writeable subfeed
    async _feedApiSetAccessRules(req, res) {
        const reqData = req.body;
        const {
            feedId, subfeedHash, accessRules
        } = reqData;
        if (!isFeedId(feedId)) throw Error('Error in _feedApiSetAccessRules: invalid feedId')
        if (!isSubfeedHash(subfeedHash)) throw Error('Error in _feedApiSetAccessRules: invalid subfeedHash')
        if (!isAccessRules(accessRules)) throw Error('Error in _feedApiSetAccessRules: invalid accessRules')
        await this._node.feedManager().setAccessRules({feedId, subfeedHash, accessRules});
        res.json({ success: true });
    }
    // Helper function for returning http request with an error response
    async _errorResponse(req, res, code, errorString) {
        console.info(`Responding with error: ${code} ${errorString}`);
        try {
            res.status(code).send(errorString);
        }
        catch(err) {
            console.warn(`Problem sending error`, {error: err.message});
        }
        await sleepMsec(100);
        try {
            req.connection.destroy();
        }
        catch(err) {
            console.warn('Problem destroying connection', {error: err.message});
        }
    }
    // /feed/watchForNewMessages - wait until new messages have been appended to a list of watched subfeeds
    async _feedApiWatchForNewMessages(req, res) {
        const reqData = req.body;
        const {
            subfeedWatches, waitMsec
        } = reqData;
        // assert(typeof(waitMsec) === 'number');
        if (!isNumber(waitMsec)) {
            throw Error('Invalid waitMsec in _feedApiWatchForNewMessages')
        }
        if (!isSubfeedWatches(subfeedWatches)) {
            throw Error('Invalid subfeedWatches in _feedApiWatchForNewMessages')
        }
        const messages = await this._node.feedManager().watchForNewMessages({
            subfeedWatches, waitMsec, maxNumMessages: 0
        });
        res.json({ success: true, messages });
    }
    // Start listening via http/https
    async listen(port) {
        const stopper = {
            onStop: cb => {
                this._stopper_callbacks.push(cb);
            }
        }
        await start_http_server(this._app, port, stopper);
    }
}

const isLocalRequest = (req) => {
    return (req.connection.localAddress === req.connection.remoteAddress);
}