import express, { Express } from 'express';
import http from 'http';
import https from 'https';
import JsonSocket from 'json-socket';
import { Socket } from 'net';
import { action } from '../common/action';
import start_http_server from '../common/start_http_server';
import { sleepMsec } from '../common/util';
import { ChannelName, FeedId, FeedName, FileKey, FindFileResult, FindLiveFeedResult, isArrayOf, isChannelName, isFeedId, isFeedName, isFileKey, isJSONObject, isNodeId, isNull, isNumber, isOneOf, isSubfeedAccessRules, isSubfeedHash, isSubfeedMessage, isSubfeedWatches, isSubmittedSubfeedMessage, JSONObject, mapToObject, NodeId, optional, Port, SignedSubfeedMessage, SubfeedAccessRules, SubfeedHash, SubfeedMessage, SubfeedWatches, SubmittedSubfeedMessage, toSubfeedWatchesRAM, _validateObject } from '../interfaces/core';
import KacheryP2PNode, { LoadFileProgress } from '../KacheryP2PNode';
import { daemonVersion, protocolVersion } from '../protocolVersion';
import { DurationMsec, isDurationMsec } from '../udp/UdpCongestionManager';
import { ApiProbeResponse } from './PublicApiServer';

interface Req {
    body: any,
    on: (eventName: string, callback: () => void) => void,
    connection: Socket
}

interface Res {
    json: (obj: {
        success: boolean
    } & JSONObject) => void,
    end: () => void,
    status: (s: number) => Res,
    send: (x: any) => Res
}

export interface ApiFindFileRequest {
    fileKey: FileKey,
    timeoutMsec: DurationMsec,
    fromChannel: ChannelName | null
}
const isApiFindFileRequest = (x: any): x is ApiFindFileRequest => {
    return _validateObject(x, {
        fileKey: isFileKey,
        timeoutMsec: isDurationMsec,
        fromChannel: isOneOf([isNull, isChannelName])
    });
}

export default class DaemonApiServer {
    #node: KacheryP2PNode
    #app: Express
    #server: http.Server | https.Server | null = null

    // This is the API server for the local daemon
    // The local Python code communicates with the daemon
    // via this API
    constructor(node: KacheryP2PNode, opts: {verbose: number}) {
        this.#node = node; // The kachery-p2p daemon
        this.#app = express(); // the express app

        this.#app.set('json spaces', 4); // when we respond with json, this is how it will be formatted
        // this.#app.use(cors()); // in the future, if we want to do this
        this.#app.use(express.json());

        this.#app.all('/*', (req, res, next) => {
            if (!isLocalRequest(req)) {
                console.warn(`Rejecting access to remote request from ${req.connection.remoteAddress}`);
                res.send("API only accessible from the local device").status(403).end();
                return;
            }
            next();
        });

        // /probe - check whether the daemon is up and running and return info such as the node ID
        this.#app.get('/probe', async (req, res) => {
            /////////////////////////////////////////////////////////////////////////
            await action('/probe', {context: 'Daemon API'}, async () => {
                await this._apiProbe(req, res) 
            }, async (err: Error) => {
                await this._errorResponse(req, res, 500, err.message);
            });
            /////////////////////////////////////////////////////////////////////////
        });
        // /halt - halt the kachery-p2p daemon (stops the server process)
        this.#app.get('/halt', async (req, res) => {
            /////////////////////////////////////////////////////////////////////////
            await action('/halt', {context: 'Daemon API'}, async () => {
                await this._apiHalt(req, res)
                await sleepMsec(3000);
                process.exit(0);
            }, async (err: Error) => {
                await this._errorResponse(req, res, 500, err.message);
            });
            /////////////////////////////////////////////////////////////////////////
        });
        // /findFile - find a file (or feed) in the remote nodes. May return more than one.
        this.#app.post('/findFile', async (req, res) => {
            /////////////////////////////////////////////////////////////////////////
            await action('/findFile', {context: 'Daemon API'}, async () => {
                await this._apiFindFile(req, res)
            }, async (err: Error) => {
                await this._errorResponse(req, res, 500, err.message);
            });
            /////////////////////////////////////////////////////////////////////////
        });
        // /loadFile - download file from remote node(s) and store in kachery storage
        this.#app.post('/loadFile', async (req, res) => {
            /////////////////////////////////////////////////////////////////////////
            await action('/loadFile', {context: 'Daemon API'}, async () => {
                await this._apiLoadFile(req, res)
            }, async (err: Error) => {
                res.status(500).send('Error loading file.');
            });
            /////////////////////////////////////////////////////////////////////////
        });
        // /feed/createFeed - create a new writeable feed on this node
        this.#app.post('/feed/createFeed', async (req, res) => {
            /////////////////////////////////////////////////////////////////////////
            await action('/feed/createFeed', {context: 'Daemon API'}, async () => {
                await this._feedApiCreateFeed(req, res)
            }, async (err: Error) => {
                await this._errorResponse(req, res, 500, err.message);
            });
            /////////////////////////////////////////////////////////////////////////
        });
        // /feed/deleteFeed - delete feed on this node
        this.#app.post('/feed/deleteFeed', async (req, res) => {
            /////////////////////////////////////////////////////////////////////////
            await action('/feed/deleteFeed', {context: 'Daemon API'}, async () => {
                await this._feedApiDeleteFeed(req, res)
            }, async (err: Error) => {
                await this._errorResponse(req, res, 500, err.message);
            });
            /////////////////////////////////////////////////////////////////////////
        });
        // /feed/getFeedId - lookup the ID of a local feed based on its name
        this.#app.post('/feed/getFeedId', async (req, res) => {
            /////////////////////////////////////////////////////////////////////////
            await action('/feed/getFeedId', {context: 'Daemon API'}, async () => {
                await this._feedApiGetFeedId(req, res)
            }, async (err: Error) => {
                await this._errorResponse(req, res, 500, err.message);
            });
            /////////////////////////////////////////////////////////////////////////
        });
        // /feed/appendMessages - append messages to a local writeable subfeed
        this.#app.post('/feed/appendMessages', async (req, res) => {
            /////////////////////////////////////////////////////////////////////////
            await action('/feed/appendMessages', {context: 'Daemon API'}, async () => {
                await this._feedApiAppendMessages(req, res)
            }, async (err: Error) => {
                await this._errorResponse(req, res, 500, err.message);
            });
            /////////////////////////////////////////////////////////////////////////
        });
        // /feed/submitMessage - submit messages to a remote live subfeed (must have permission)
        this.#app.post('/feed/submitMessage', async (req, res) => {
            /////////////////////////////////////////////////////////////////////////
            await action('/feed/submitMessage', {context: 'Daemon API'}, async () => {
                await this._feedApiSubmitMessage(req, res)
            }, async (err: Error) => {
                await this._errorResponse(req, res, 500, err.message);
            });
            /////////////////////////////////////////////////////////////////////////
        });
        // /feed/getMessages - get messages from a local or remote subfeed
        this.#app.post('/feed/getMessages', async (req, res) => {
            /////////////////////////////////////////////////////////////////////////
            await action('/feed/getMessages', {context: 'Daemon API'}, async () => {
                await this._feedApiGetMessages(req, res)
            }, async (err: Error) => {
                await this._errorResponse(req, res, 500, err.message);
            });
            /////////////////////////////////////////////////////////////////////////
        });
        // /feed/getSignedMessages - get signed messages from a local or remote subfeed
        this.#app.post('/feed/getSignedMessages', async (req, res) => {
            /////////////////////////////////////////////////////////////////////////
            await action('/feed/getSignedMessages', {context: 'Daemon API'}, async () => {
                await this._feedApiGetSignedMessages(req, res)
            }, async (err: Error) => {
                await this._errorResponse(req, res, 500, err.message);
            });
            /////////////////////////////////////////////////////////////////////////
        });
        // /feed/getNumMessages - get number of messages in a subfeed
        this.#app.post('/feed/getNumMessages', async (req, res) => {
            /////////////////////////////////////////////////////////////////////////
            await action('/feed/getNumMessages', {context: 'Daemon API'}, async () => {
                await this._feedApiGetNumMessages(req, res)
            }, async (err: Error) => {
                await this._errorResponse(req, res, 500, err.message);
            });
            /////////////////////////////////////////////////////////////////////////
        });
        // /feed/getLiveFeedInfo - get info for a feed - such as whether it is writeable
        this.#app.post('/feed/getLiveFeedInfo', async (req, res) => {
            /////////////////////////////////////////////////////////////////////////
            await action('/feed/getLiveFeedInfo', {context: 'Daemon API'}, async () => {
                await this._feedApiGetLiveFeedInfo(req, res)
            }, async (err: Error) => {
                await this._errorResponse(req, res, 500, err.message);
            });
            /////////////////////////////////////////////////////////////////////////
        });
        // /feed/getAccessRules - get access rules for a local writeable subfeed
        this.#app.post('/feed/getAccessRules', async (req, res) => {
            /////////////////////////////////////////////////////////////////////////
            await action('/feed/getAccessRules', {context: 'Daemon API'}, async () => {
                await this._feedApiGetAccessRules(req, res)
            }, async (err: Error) => {
                await this._errorResponse(req, res, 500, err.message);
            });
            /////////////////////////////////////////////////////////////////////////
        });
        // /feed/setAccessRules - set access rules for a local writeable subfeed
        this.#app.post('/feed/setAccessRules', async (req, res) => {
            /////////////////////////////////////////////////////////////////////////
            await action('/feed/setAccessRules', {context: 'Daemon API'}, async () => {
                await this._feedApiSetAccessRules(req, res)
            }, async (err: Error) => {
                await this._errorResponse(req, res, 500, err.message);
            });
            /////////////////////////////////////////////////////////////////////////
        });
        // /feed/watchForNewMessages - wait until new messages have been appended to a list of watched subfeeds
        this.#app.post('/feed/watchForNewMessages', async (req, res) => {
            /////////////////////////////////////////////////////////////////////////
            await action('/feed/watchForNewMessages', {context: 'Daemon API'}, async () => {
                await this._feedApiWatchForNewMessages(req, res)
            }, async (err: Error) => {
                await this._errorResponse(req, res, 500, err.message);
            });
            /////////////////////////////////////////////////////////////////////////
        });
    }
    stop() {
        if (this.#server) {
            this.#server.close()
        }
    }
    async mockPostJson(path: string, data: JSONObject): Promise<JSONObject> {
        if (path === '/probe') {
            return await this._probe() as any as JSONObject
        }
        else {
            throw Error(`mock unexpected path: ${path}`)
        }
    }
    mockPostLoadFile(data: JSONObject): {
        onFinished: (callback: () => void) => void,
        onProgress: (callback: (progress: LoadFileProgress) => void) => void,
        onError: (callback: (err: Error) => void) => void,
        cancel: () => void
    } {
        return this._loadFile(data)
    }
    async mockPostFindFile(reqData: ApiFindFileRequest): Promise<{
        onFound: (callback: (result: FindFileResult) => void) => void;
        onFinished: (callback: () => void) => void;
        cancel: () => void;
    }> {
        return await this._findFile(reqData)
    }
    // /probe - check whether the daemon is up and running and return info such as the node ID
    async _apiProbe(req: Req, res: Res) {
        const response = await this._probe()
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        res.json(response);
    }
    async _probe() {
        const response: ApiProbeResponse = {
            success: true,
            protocolVersion: protocolVersion(),
            daemonVersion: daemonVersion(),
            nodeId: this.#node.nodeId(),
            isBootstrapNode: this.#node.isBootstrapNode(),
            webSocketAddress: this.#node.webSocketAddress(),
            publicUdpSocketAddress: this.#node.publicUdpSocketAddress()
        }
        return response
    }
    // /halt - halt the kachery-p2p daemon (stops the server process)
    async _apiHalt(req: Req, res: Res) {
        interface ApiHaltResponse {
            success: boolean
        };
        this.stop()
        const response: ApiHaltResponse = { success: true };
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        res.json(response);
    }
    // /findFile - find a file (or feed) in the remote nodes. May return more than one.
    async _apiFindFile(req: Req, res: Res) {
        const reqData = req.body;
        if (!isApiFindFileRequest(reqData)) throw Error('Invalid request in _apiFindFile');
        
        const x = await this._findFile(reqData)

        const jsonSocket = new JsonSocket(res as any as Socket);

        let isDone = false;
        x.onFound(result => {
            if (isDone) return;
            // may return more than one result
            // we send them one-by-one
            jsonSocket.sendMessage(result, () => {});
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
    async _findFile(reqData: ApiFindFileRequest) {
        const { fileKey, timeoutMsec, fromChannel } = reqData;
        return this.#node.findFile({fileKey, timeoutMsec, fromChannel});
    }
    // /loadFile - load a file from remote kachery node(s) and store in kachery storage
    async _apiLoadFile(req: Req, res: Res) {
        const x = this._loadFile(req.body)
        const jsonSocket = new JsonSocket(res as any as Socket)
        let isDone = false;
        // todo: track progress
        x.onFinished(() => {
            if (isDone) return;
            // we are done
            isDone = true;
            jsonSocket.sendMessage({type: 'finished'}, () => {});
            res.end();
        });
        x.onError((err) => {
            if (isDone) return;
            isDone = true;
            jsonSocket.sendMessage({type: 'error', error: err.message}, () => {});
            res.end();
        });
        x.onProgress((prog) => {
            jsonSocket.sendMessage({
                type: 'progress',
                bytesLoaded: prog.bytesLoaded,
                bytesTotal: prog.bytesTotal,
                nodeId: prog.nodeId || ''
            }, () => {});
        });
        req.on('close', () => {
            // if the request socket is closed, we cancel the load request
            isDone = true;
            x.cancel();
        });
    }
    _loadFile(reqData: JSONObject) {
        interface ApiLoadFileRequest {
            fileKey: FileKey,
            fromNode: NodeId | null,
            fromChannel: ChannelName | null
        }
        const isApiLoadFileRequest = (x: any): x is ApiLoadFileRequest => {
            return _validateObject(x, {
                fileKey: isFileKey,
                fromNode: optional(isNodeId),
                fromChannel: optional(isChannelName)
            });
        }
        if (!isApiLoadFileRequest(reqData)) throw Error('Invalid request in _apiLoadFile');

        const { fileKey, fromNode, fromChannel } = reqData;
        const x = this.#node.loadFile({
            fileKey: fileKey,
            opts: {fromNode, fromChannel}
        });
        return x
    }
    // /feed/createFeed - create a new writeable feed on this node
    async _feedApiCreateFeed(req: Req, res: Res) {
        interface FeedApiCreateFeedRequest {
            feedName?: FeedName
        }
        const isFeedApiCreateFeedRequest = (x: any): x is FeedApiCreateFeedRequest => {
            return _validateObject(x, {
                feedName: optional(isFeedName)
            });
        }
        interface FeedApiCreateFeedResponse {
            success: boolean,
            feedId: FeedId
        }
        const reqData = req.body;
        if (!isFeedApiCreateFeedRequest(reqData)) throw Error('Invalid request in _feedApiCreateFeed');

        const feedName = reqData.feedName || null;
        const feedId = await this.#node.feedManager().createFeed({feedName});
        const response: FeedApiCreateFeedResponse = { success: true, feedId };
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        res.json(response);
    }
    // /feed/deleteFeed - delete feed on this node
    async _feedApiDeleteFeed(req: Req, res: Res) {
        interface FeedApiDeleteFeedRequest {
            feedId: FeedId
        }
        const isFeedApiDeleteFeedRequest = (x: any): x is FeedApiDeleteFeedRequest => {
            return _validateObject(x, {
                feedId: isFeedId
            });
        }
        interface FeedApiDeleteFeedResponse {
            success: boolean
        }
        const reqData = req.body;
        if (!isFeedApiDeleteFeedRequest(reqData)) throw Error('Invalid request in _feedApiDeleteFeed');

        const { feedId } = reqData;
        await this.#node.feedManager().deleteFeed({feedId});

        const response: FeedApiDeleteFeedResponse = {success: true}
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        res.json(response);
    }
    // /feed/getFeedId - lookup the ID of a local feed based on its name
    async _feedApiGetFeedId(req: Req, res: Res) {
        interface FeedApiGetFeedIdRequest {
            feedName: FeedName
        }
        const isFeedApiGetFeedIdRequest = (x: any): x is FeedApiGetFeedIdRequest => {
            return _validateObject(x, {
                feedName: isFeedName
            });
        }
        interface FeedApiGetFeedIdResponse {
            success: boolean,
            feedId: FeedId | null
        }
        const reqData = req.body;
        if (!isFeedApiGetFeedIdRequest(reqData)) throw Error('Invalid request in _feedApiGetFeedId');
        const { feedName } = reqData;
        const feedId = await this.#node.feedManager().getFeedId({feedName});
        let response: FeedApiGetFeedIdResponse;
        if (!feedId) {
            response = { success: false, feedId: null };
        }
        else {
            response = { success: true, feedId };
        }
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        res.json(response);
    }
    // /feed/appendMessages - append messages to a local writeable subfeed
    async _feedApiAppendMessages(req: Req, res: Res) {
        interface FeedApiAppendMessagesRequest {
            feedId: FeedId,
            subfeedHash: SubfeedHash,
            messages: SubfeedMessage[]
        }
        const isFeedApiAppendMessagesRequest = (x: any): x is FeedApiAppendMessagesRequest => {
            return _validateObject(x, {
                feedId: isFeedId,
                subfeedHash: isSubfeedHash,
                messages: isArrayOf(isSubfeedMessage)
            });
        }
        interface FeedApiAppendMessagesResponse {
            success: boolean
        }
        const reqData = req.body;
        if (!isFeedApiAppendMessagesRequest(reqData)) throw Error('Invalid request in _feedApiAppendMessages');

        const { feedId, subfeedHash, messages } = reqData;

        await this.#node.feedManager().appendMessages({
            feedId, subfeedHash, messages
        });

        const response: FeedApiAppendMessagesResponse = {success: true}
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        res.json(response);
    }
    // /feed/submitMessage - submit message to a remote live subfeed (must have permission)
    async _feedApiSubmitMessage(req: Req, res: Res) {
        interface FeedApiSubmitMessageRequest {
            feedId: FeedId,
            subfeedHash: SubfeedHash,
            message: SubmittedSubfeedMessage,
            timeoutMsec: DurationMsec
        }
        const isFeedApiSubmitMessageRequest = (x: any): x is FeedApiSubmitMessageRequest => {
            return _validateObject(x, {
                feedId: isFeedId,
                subfeedHash: isSubfeedHash,
                message: isSubmittedSubfeedMessage,
                timeoutMsec: isDurationMsec
            });
        }
        interface FeedApiSubmitMessageResponse {
            success: boolean
        }
        const reqData = req.body;
        if (!isFeedApiSubmitMessageRequest(reqData)) throw Error('Invalid request in _feedApiSubmitMessage');

        const { feedId, subfeedHash, message, timeoutMsec } = reqData;

        await this.#node.feedManager().submitMessage({feedId, subfeedHash, message, timeoutMsec});

        const response: FeedApiSubmitMessageResponse = {success: true}
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        res.json(response);
    }
    // /feed/getMessages - get messages from a local or remote subfeed
    async _feedApiGetMessages(req: Req, res: Res) {
        interface FeedApiGetMessagesRequest {
            feedId: FeedId,
            subfeedHash: SubfeedHash,
            position: number,
            maxNumMessages: number,
            waitMsec: DurationMsec
        }
        const isFeedApiGetMessagesRequest = (x: any): x is FeedApiGetMessagesRequest => {
            return _validateObject(x, {
                feedId: isFeedId,
                subfeedHash: isSubfeedHash,
                position: isNumber,
                maxNumMessages: isNumber,
                waitMsec: isDurationMsec,
            });
        }
        interface FeedApiGetMessagesResponse {
            success: boolean,
            messages: SubfeedMessage[]
        }
        const reqData = req.body;
        if (!isFeedApiGetMessagesRequest(reqData)) throw Error('Invalid request in _feedApiGetMessages');

        const { feedId, subfeedHash, position, maxNumMessages, waitMsec } = reqData;

        const messages = await this.#node.feedManager().getMessages({
            feedId, subfeedHash, position, maxNumMessages, waitMsec
        });

        const response: FeedApiGetMessagesResponse = {success: true, messages}
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        res.json(response);
    }
    // /feed/getSignedMessages - get signed messages from a local or remote subfeed
    async _feedApiGetSignedMessages(req: Req, res: Res) {
        interface FeedApiGetSignedMessagesRequest {
            feedId: FeedId,
            subfeedHash: SubfeedHash,
            position: number,
            maxNumMessages: number,
            waitMsec: DurationMsec
        }
        const isFeedApiGetSignedMessagesRequest = (x: any): x is FeedApiGetSignedMessagesRequest => {
            return _validateObject(x, {
                feedId: isFeedId,
                subfeedHash: isSubfeedHash,
                position: isNumber,
                maxNumMessages: isNumber,
                waitMsec: isDurationMsec,
            });
        }
        interface FeedApiGetSignedMessagesResponse {
            success: boolean,
            signedMessages: SignedSubfeedMessage[]
        }
        const reqData = req.body;
        if (!isFeedApiGetSignedMessagesRequest(reqData)) throw Error('Invalid request in _feedApiGetSignedMessages');

        const { feedId, subfeedHash, position, maxNumMessages, waitMsec } = reqData;

        const signedMessages = await this.#node.feedManager().getSignedMessages({
            feedId, subfeedHash, position, maxNumMessages, waitMsec
        });

        const response: FeedApiGetSignedMessagesResponse = {success: true, signedMessages}
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        res.json(response);
    }
    // /feed/getNumMessages - get number of messages in a subfeed
    async _feedApiGetNumMessages(req: Req, res: Res) {
        interface FeedApiGetNumMessagesRequest {
            feedId: FeedId,
            subfeedHash: SubfeedHash
        }
        const isFeedApiGetNumMessagesRequest = (x: any): x is FeedApiGetNumMessagesRequest => {
            return _validateObject(x, {
                feedId: isFeedId,
                subfeedHash: isSubfeedHash
            });
        }
        interface FeedApiGetNumMessagesResponse {
            success: boolean,
            numMessages: number
        }
        const reqData = req.body;
        if (!isFeedApiGetNumMessagesRequest(reqData)) throw Error('Invalid request in _feedApiGetNumMessages');

        const { feedId, subfeedHash } = reqData;

        const numMessages = await this.#node.feedManager().getNumMessages({
            feedId, subfeedHash
        });

        const response: FeedApiGetNumMessagesResponse = {success: true, numMessages}
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        res.json(response);
    }
    // /feed/getLiveFeedInfo - get info for a feed - such as whether it is writeable
    async _feedApiGetLiveFeedInfo(req: Req, res: Res) {
        interface FeedApiGetLiveFeedInfoRequest {
            feedId: FeedId,
            timeoutMsec: DurationMsec
        }
        const isFeedApiGetLiveFeedInfoRequest = (x: any): x is FeedApiGetLiveFeedInfoRequest => {
            return _validateObject(x, {
                feedId: isFeedId,
                subfeedHash: isSubfeedHash
            });
        }
        interface FeedApiGetLiveFeedInfoResponse {
            success: boolean,
            liveFeedInfo: FindLiveFeedResult
        }
        const reqData = req.body;
        if (!isFeedApiGetLiveFeedInfoRequest(reqData)) throw Error('Invalid request in _feedApiGetLiveFeedInfo');

        const { feedId, timeoutMsec } = reqData;
        const liveFeedInfo = await this.#node.feedManager().getFeedInfo({feedId, timeoutMsec});

        const response: FeedApiGetLiveFeedInfoResponse = {success: true, liveFeedInfo}
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        res.json(response);
    }
    // /feed/getAccessRules - get access rules for a local writeable subfeed
    async _feedApiGetAccessRules(req: Req, res: Res) {
        interface FeedApiGetAccessRulesRequest {
            feedId: FeedId,
            subfeedHash: SubfeedHash
        }
        const isFeedApiGetAccessRulesRequest = (x: any): x is FeedApiGetAccessRulesRequest => {
            return _validateObject(x, {
                feedId: isFeedId,
                subfeedHash: isSubfeedHash
            });
        }
        interface FeedApiGetAccessRulesResponse {
            success: boolean,
            accessRules?: SubfeedAccessRules
        }
        const reqData = req.body;
        if (!isFeedApiGetAccessRulesRequest(reqData)) throw Error('Invalid request in _feedApiGetAccessRules');

        const { feedId, subfeedHash } = reqData;

        const accessRules = await this.#node.feedManager().getAccessRules({feedId, subfeedHash});
        let response: FeedApiGetAccessRulesResponse;
        if (accessRules) {
            response = {success: true, accessRules}
        }
        else {
            response = {success: false}
        };
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        res.json(response);
    }
    // /feed/setAccessRules - set access rules for a local writeable subfeed
    async _feedApiSetAccessRules(req: Req, res: Res) {
        interface FeedApiSetAccessRulesRequest {
            feedId: FeedId,
            subfeedHash: SubfeedHash,
            accessRules: SubfeedAccessRules
        }
        const isFeedApiSetAccessRulesRequest = (x: any): x is FeedApiSetAccessRulesRequest => {
            return _validateObject(x, {
                feedId: isFeedId,
                subfeedHash: isSubfeedHash,
                accessRules: isSubfeedAccessRules
            });
        }
        interface FeedApiSetAccessRulesResponse {
            success: boolean
        }
        const reqData = req.body;
        if (!isFeedApiSetAccessRulesRequest(reqData)) throw Error('Invalid request in _feedApiSetAccessRules');

        const { feedId, subfeedHash, accessRules } = reqData;

        await this.#node.feedManager().setAccessRules({feedId, subfeedHash, accessRules});

        const response: FeedApiSetAccessRulesResponse = {success: true}
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        res.json(response);
    }
    // /feed/watchForNewMessages - wait until new messages have been appended to a list of watched subfeeds
    async _feedApiWatchForNewMessages(req: Req, res: Res) {
        interface FeedApiWatchForNewMessagesRequest {
            subfeedWatches: SubfeedWatches,
            waitMsec: DurationMsec
        }
        const isFeedApiWatchForNewMessagesRequest = (x: any): x is FeedApiWatchForNewMessagesRequest => {
            return _validateObject(x, {
                subfeedWatches: isSubfeedWatches,
                waitMsec: isDurationMsec
            });
        }
        interface FeedApiWatchForNewMessagesResponse {
            success: boolean,
            messages: {[key: string]: SubfeedMessage[]}
        }
        const reqData = req.body;
        if (!isFeedApiWatchForNewMessagesRequest(reqData)) throw Error('Invalid request in _feedApiWatchForNewMessages');

        const { subfeedWatches, waitMsec } = reqData;

        const messages = await this.#node.feedManager().watchForNewMessages({
            subfeedWatches: toSubfeedWatchesRAM(subfeedWatches), waitMsec, maxNumMessages: 0
        });

        const response: FeedApiWatchForNewMessagesResponse = {success: true, messages: mapToObject(messages)}
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        res.json(response);
    }
    // Helper function for returning http request with an error response
    async _errorResponse(req: Req, res: Res, code: number, errorString: string) {
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
    // Start listening via http/https
    async listen(port: Port) {
        this.#server = start_http_server(this.#app, port)
    }
}

const isLocalRequest = (req: any) => {
    return (req.connection.localAddress === req.connection.remoteAddress);
}