import express, { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import JsonSocket from 'json-socket';
import { Socket } from 'net';
import { ChannelConfig, isChannelConfig } from '../cli';
import { action } from '../common/action';
import DataStreamy from '../common/DataStreamy';
import { sleepMsec } from '../common/util';
import { HttpServerInterface } from '../external/ExternalInterface';
import { isGetStatsOpts, NodeStatsInterface } from '../getStats';
import { Address, ChannelConfigUrl, DaemonVersion, DurationMsec, durationMsecToNumber, ErrorMessage, FeedId, FeedName, FileKey, FindFileResult, isAddress, isArrayOf, isBoolean, isChannelConfigUrl, isDaemonVersion, isDurationMsec, isEqualTo, isFeedId, isFeedName, isFileKey, isJSONObject, isMessageCount, isNodeId, isNull, isObjectOf, isOneOf, isSignedSubfeedMessage, isString, isSubfeedAccessRules, isSubfeedHash, isSubfeedMessage, isSubfeedPosition, isSubfeedWatches, isSubmittedSubfeedMessage, JSONObject, LocalFilePath, mapToObject, messageCount, MessageCount, NodeId, optional, Port, ProtocolVersion, scaledDurationMsec, Sha1Hash, SignedSubfeedMessage, SubfeedAccessRules, SubfeedHash, SubfeedMessage, SubfeedPosition, SubfeedWatches, SubmittedSubfeedMessage, toSubfeedWatchesRAM, _validateObject } from '../interfaces/core';
import KacheryP2PNode from '../KacheryP2PNode';
import { loadFile } from '../loadFile';
import { daemonVersion, protocolVersion } from '../protocolVersion';
import { isJoinedChannelConfig, JoinedChannelConfig } from './ConfigUpdateService';
import { PublicApiProbeResponse } from './PublicApiServer';

export interface DaemonApiProbeResponse {
    success: boolean,
    protocolVersion: ProtocolVersion,
    daemonVersion: DaemonVersion,
    nodeId: NodeId,
    isBootstrapNode: boolean,
    webSocketAddress: Address | null,
    publicUdpSocketAddress: Address | null,
    joinedChannels: JoinedChannelConfig[],
    kacheryStorageDir: LocalFilePath | null
};
export const isDaemonApiProbeResponseJoinedChannels = (x: any): x is {channelConfig: ChannelConfig, channelConfigUrl: ChannelConfigUrl} => {
    return _validateObject(x, {
        channelConfig: isChannelConfig,
        channelConfigUrl: isChannelConfigUrl
    });
}
export const isDaemonApiProbeResponse = (x: any): x is PublicApiProbeResponse => {
    return _validateObject(x, {
        success: isBoolean,
        protocolVersion: isEqualTo(protocolVersion()),
        daemonVersion: isDaemonVersion,
        nodeId: isNodeId,
        isBootstrapNode: isBoolean,
        webSocketAddress: isOneOf([isNull, isAddress]),
        publicUdpSocketAddress: isOneOf([isNull, isAddress]),
        joinedChannels: isArrayOf(isJoinedChannelConfig),
        kacheryStorageDir: isOneOf([isNull, isString])
    });
}

type StoreFileRequestData = {
    localFilePath: LocalFilePath
}
const isStoreFileRequestData = (x: any): x is StoreFileRequestData => {
    return _validateObject(x, {
        localFilePath: isString
    })
}
type StoreFileResponseData = {
    success: boolean
    error: ErrorMessage | null
    sha1: Sha1Hash | null
    manifestSha1: Sha1Hash | null
}

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
    timeoutMsec: DurationMsec
}
const isApiFindFileRequest = (x: any): x is ApiFindFileRequest => {
    return _validateObject(x, {
        fileKey: isFileKey,
        timeoutMsec: isDurationMsec
    });
}

export interface ApiLoadFileRequest {
    fileKey: FileKey,
    fromNode: NodeId | null
}
const isApiLoadFileRequest = (x: any): x is ApiLoadFileRequest => {
    return _validateObject(x, {
        fileKey: isFileKey,
        fromNode: isOneOf([isNull, isNodeId])
    });
}

export interface FeedApiWatchForNewMessagesRequest {
    subfeedWatches: SubfeedWatches,
    waitMsec: DurationMsec,
    maxNumMessages?: MessageCount,
    signed?: boolean
}
export const isFeedApiWatchForNewMessagesRequest = (x: any): x is FeedApiWatchForNewMessagesRequest => {
    return _validateObject(x, {
        subfeedWatches: isSubfeedWatches,
        waitMsec: isDurationMsec,
        signed: optional(isBoolean),
        maxNumMessages: optional(isMessageCount)
    })
}
export interface FeedApiWatchForNewMessagesResponse {
    success: boolean,
    messages: {[key: string]: SubfeedMessage[]} | {[key: string]: SignedSubfeedMessage[]}
}
export const isFeedApiWatchForNewMessagesResponse = (x: any): x is FeedApiWatchForNewMessagesResponse => {
    return _validateObject(x, {
        success: isBoolean,
        messages: isOneOf([isObjectOf(isString, isArrayOf(isSubfeedMessage)), isObjectOf(isString, isArrayOf(isSignedSubfeedMessage))])
    })
}

export interface FeedApiGetMessagesRequest {
    feedId: FeedId,
    subfeedHash: SubfeedHash,
    position: SubfeedPosition,
    maxNumMessages: MessageCount,
    waitMsec: DurationMsec
}
export const isFeedApiGetMessagesRequest = (x: any): x is FeedApiGetMessagesRequest => {
    return _validateObject(x, {
        feedId: isFeedId,
        subfeedHash: isSubfeedHash,
        position: isSubfeedPosition,
        maxNumMessages: isMessageCount,
        waitMsec: isDurationMsec,
    });
}
export interface FeedApiGetMessagesResponse {
    success: boolean,
    messages: SubfeedMessage[]
}
export const isFeedApiGetMessagesResponse = (x: any): x is FeedApiGetMessagesResponse => {
    return _validateObject(x, {
        success: isBoolean,
        messages: isArrayOf(isSubfeedMessage)
    });
}

export interface FeedApiGetSignedMessagesRequest {
    feedId: FeedId,
    subfeedHash: SubfeedHash,
    position: SubfeedPosition,
    maxNumMessages: MessageCount,
    waitMsec: DurationMsec
}
export const isFeedApiGetSignedMessagesRequest = (x: any): x is FeedApiGetSignedMessagesRequest => {
    return _validateObject(x, {
        feedId: isFeedId,
        subfeedHash: isSubfeedHash,
        position: isSubfeedPosition,
        maxNumMessages: isMessageCount,
        waitMsec: isDurationMsec,
    });
}
export interface FeedApiGetSignedMessagesResponse {
    success: boolean,
    signedMessages: SignedSubfeedMessage[]
}
export const isFeedApiGetSignedMessagesResponse = (x: any): x is FeedApiGetSignedMessagesResponse => {
    return _validateObject(x, {
        success: isBoolean,
        signedMessages: isArrayOf(isSignedSubfeedMessage)
    });
}

export interface FeedApiCreateFeedRequest {
    feedName?: FeedName
}
export const isFeedApiCreateFeedRequest = (x: any): x is FeedApiCreateFeedRequest => {
    return _validateObject(x, {
        feedName: optional(isFeedName)
    });
}
export interface FeedApiCreateFeedResponse {
    success: boolean,
    feedId: FeedId
}
export const isFeedApiCreateFeedResponse = (x: any): x is FeedApiCreateFeedResponse => {
    return _validateObject(x, {
        success: isBoolean,
        feedId: isFeedId
    });
}

export interface FeedApiAppendMessagesRequest {
    feedId: FeedId,
    subfeedHash: SubfeedHash,
    messages: SubfeedMessage[]
}
export const isFeedApiAppendMessagesRequest = (x: any): x is FeedApiAppendMessagesRequest => {
    return _validateObject(x, {
        feedId: isFeedId,
        subfeedHash: isSubfeedHash,
        messages: isArrayOf(isSubfeedMessage)
    });
}
export interface FeedApiAppendMessagesResponse {
    success: boolean
}
export const isFeedApiAppendMessagesResponse = (x: any): x is FeedApiAppendMessagesResponse => {
    return _validateObject(x, {
        success: isBoolean
    });
}

export interface FeedApiSubmitMessageRequest {
    feedId: FeedId,
    subfeedHash: SubfeedHash,
    message: SubmittedSubfeedMessage,
    timeoutMsec: DurationMsec
}
export const isFeedApiSubmitMessageRequest = (x: any): x is FeedApiSubmitMessageRequest => {
    return _validateObject(x, {
        feedId: isFeedId,
        subfeedHash: isSubfeedHash,
        message: isSubmittedSubfeedMessage,
        timeoutMsec: isDurationMsec
    });
}
export interface FeedApiSubmitMessageResponse {
    success: boolean
}
export const isFeedApiSubmitMessageResponse = (x: any): x is FeedApiSubmitMessageResponse => {
    return _validateObject(x, {
        success: isBoolean
    })
}

export interface FeedApiGetNumLocalMessagesRequest {
    feedId: FeedId,
    subfeedHash: SubfeedHash
}
export const isFeedApiGetNumLocalMessagesRequest = (x: any): x is FeedApiGetNumLocalMessagesRequest => {
    return _validateObject(x, {
        feedId: isFeedId,
        subfeedHash: isSubfeedHash
    });
}
export interface FeedApiGetNumLocalMessagesResponse {
    success: boolean,
    numMessages: MessageCount
}
export const isFeedApiGetNumLocalMessagesResponse = (x: any): x is FeedApiGetNumLocalMessagesResponse => {
    return _validateObject(x, {
        success: isBoolean,
        numMessages: isMessageCount
    });
}

export interface FeedApiGetFeedInfoRequest {
    feedId: FeedId,
    timeoutMsec: DurationMsec
}
export const isFeedApiGetFeedInfoRequest = (x: any): x is FeedApiGetFeedInfoRequest => {
    return _validateObject(x, {
        feedId: isFeedId,
        timeoutMsec: isDurationMsec
    });
}
export interface FeedApiGetFeedInfoResponse {
    success: boolean,
    isWriteable: boolean,
    nodeId: NodeId
}
export const isFeedApiGetFeedInfoResponse = (x: any): x is FeedApiGetFeedInfoResponse => {
    return _validateObject(x, {
        success: isBoolean,
        isWriteable: isBoolean,
        nodeId: isNodeId
    })
}

export interface FeedApiDeleteFeedRequest {
    feedId: FeedId
}
export const isFeedApiDeleteFeedRequest = (x: any): x is FeedApiDeleteFeedRequest => {
    return _validateObject(x, {
        feedId: isFeedId
    });
}
export interface FeedApiDeleteFeedResponse {
    success: boolean
}
export const isFeedApiDeleteFeedResponse = (x: any): x is FeedApiDeleteFeedResponse => {
    return _validateObject(x, {
        success: isBoolean
    });
}

export interface FeedApiGetFeedIdRequest {
    feedName: FeedName
}
export const isFeedApiGetFeedIdRequest = (x: any): x is FeedApiGetFeedIdRequest => {
    return _validateObject(x, {
        feedName: isFeedName
    });
}
export interface FeedApiGetFeedIdResponse {
    success: boolean,
    feedId: FeedId | null
}
export const isFeedApiGetFeedIdResponse = (x: any): x is FeedApiGetFeedIdResponse => {
    return _validateObject(x, {
        success: isBoolean,
        feedId: isOneOf([isNull, isFeedId])
    });
}

export interface FeedApiGetAccessRulesRequest {
    feedId: FeedId,
    subfeedHash: SubfeedHash
}
export const isFeedApiGetAccessRulesRequest = (x: any): x is FeedApiGetAccessRulesRequest => {
    return _validateObject(x, {
        feedId: isFeedId,
        subfeedHash: isSubfeedHash
    });
}
export interface FeedApiGetAccessRulesResponse {
    success: boolean,
    accessRules: SubfeedAccessRules | null
}
export const isFeedApiGetAccessRulesResponse = (x: any): x is FeedApiGetAccessRulesResponse => {
    return _validateObject(x, {
        success: isBoolean,
        accessRules: isOneOf([isNull, isSubfeedAccessRules])
    });
}

export interface FeedApiSetAccessRulesRequest {
    feedId: FeedId,
    subfeedHash: SubfeedHash,
    accessRules: SubfeedAccessRules
}
export const isFeedApiSetAccessRulesRequest = (x: any): x is FeedApiSetAccessRulesRequest => {
    return _validateObject(x, {
        feedId: isFeedId,
        subfeedHash: isSubfeedHash,
        accessRules: isSubfeedAccessRules
    });
}
export interface FeedApiSetAccessRulesResponse {
    success: boolean
}
export const isFeedApiSetAccessRulesResponse = (x: any): x is FeedApiSetAccessRulesResponse => {
    return _validateObject(x, {
        success: isBoolean
    });
}

export default class DaemonApiServer {
    #node: KacheryP2PNode
    #app: Express
    // #server: http.Server | https.Server | null = null
    #server: HttpServerInterface | null = null
    #simpleGetHandlers: {
        path: string,
        handler: (query: JSONObject) => Promise<JSONObject>,
    }[] = [
        {
            // /probe - check whether the daemon is up and running and return info such as the node ID
            path: '/probe',
            handler: async (query) => {
                /* istanbul ignore next */
                return await this._handleProbe()
            }
        },
        {
            // /halt - halt the kachery-p2p daemon (stops the server process)
            path: '/halt',
            handler: async (query) => {
                /* istanbul ignore next */
                return await this._handleHalt()
            }
        },
        {
            path: '/stats',
            handler: async (query) => {
                return await this._handleStats(query)
            }
        }
    ]
    #simplePostHandlers: {
        path: string,
        handler: (reqData: JSONObject) => Promise<JSONObject>,
    }[] = [
        {
            // /probe - check whether the daemon is up and running and return info such as the node ID
            path: '/probe',
            handler: async (reqData: JSONObject) => {
                /* istanbul ignore next */
                return await this._handleProbe()
            }
        },
        {
            // /storeFile - Store a local file in local kachery storage
            path: '/storeFile',
            handler: async (reqData: JSONObject) => {
                /* istanbul ignore next */
                return await this._handleStoreFile(reqData)
            }
        },
        {
            // /feed/createFeed - create a new writeable feed on this node
            path: '/feed/createFeed',
            handler: async (reqData: JSONObject) => {return await this._handleFeedApiCreateFeed(reqData)}
        },
        {
            // /feed/deleteFeed - delete feed on this node
            path: '/feed/deleteFeed',
            handler: async (reqData: JSONObject) => {return await this._handleFeedApiDeleteFeed(reqData)}
        },
        {
            // /feed/getFeedId - lookup the ID of a local feed based on its name
            path: '/feed/getFeedId',
            handler: async (reqData: JSONObject) => {return await this._handleFeedApiGetFeedId(reqData)}
        },
        {
            // /feed/appendMessages - append messages to a local writeable subfeed
            path: '/feed/appendMessages',
            handler: async (reqData: JSONObject) => {return await this._handleFeedApiAppendMessages(reqData)}
        },
        {
            // /feed/submitMessage - submit messages to a remote live subfeed (must have permission)
            path: '/feed/submitMessage',
            handler: async (reqData: JSONObject) => {return await this._handleFeedApiSubmitMessage(reqData)}
        },
        {
            // /feed/getNumLocalMessages - get number of messages in a subfeed
            path: '/feed/getNumLocalMessages',
            handler: async (reqData: JSONObject) => {return await this._handleFeedApiGetNumLocalMessages(reqData)}
        },
        {
            // /feed/getFeedInfo - get info for a feed - such as whether it is writeable
            path: '/feed/getFeedInfo',
            handler: async (reqData: JSONObject) => {return await this._handleFeedApiGetFeedInfo(reqData)}
        },
        {
            // /feed/getAccessRules - get access rules for a local writeable subfeed
            path: '/feed/getAccessRules',
            handler: async (reqData: JSONObject) => {return await this._handleFeedApiGetAccessRules(reqData)}
        },
        {
            // /feed/setAccessRules - set access rules for a local writeable subfeed
            path: '/feed/setAccessRules',
            handler: async (reqData: JSONObject) => {return await this._handleFeedApiSetAccessRules(reqData)}
        },
        {
            // /feed/watchForNewMessages - wait until new messages have been appended to a list of watched subfeeds
            path: '/feed/watchForNewMessages',
            handler: async (reqData: JSONObject) => {return await this._handleFeedApiWatchForNewMessages(reqData)}
        }
    ]

    // This is the API server for the local daemon
    // The local Python code communicates with the daemon
    // via this API
    constructor(node: KacheryP2PNode, opts: {verbose: number}) {
        this.#node = node; // The kachery-p2p daemon
        this.#app = express(); // the express app

        this.#app.set('json spaces', 4); // when we respond with json, this is how it will be formatted
        // this.#app.use(cors()); // in the future, if we want to do this
        this.#app.use(express.json());

        this.#app.all('/*', (req: Request, res: Response, next: NextFunction) => {
            // if (!isLocalRequest(req)) {
            //     console.warn(`Rejecting access to remote request from ${req.socket.remoteAddress}`);
            //     res.status(403).send("API only accessible from the local device").end();
            //     return;
            // }

            if (req.path !== '/probe') {
                const authCode = req.header('KACHERY-CLIENT-AUTH-CODE')
                if (!authCode) {
                    res.status(403).send("Missing client auth code in daemon request. You probably need to upgrade kachery-p2p.").end();
                    return;
                }
                if (!this.#node.verifyClientAuthCode(authCode)) {
                    res.status(403).send("Incorrect client authorization code.").end();
                    return;
                }
            }
            
            /* istanbul ignore next */
            next();
        });

        
        this.#simpleGetHandlers.forEach(h => {
            this.#app.get(h.path, async (req, res) => {
                /////////////////////////////////////////////////////////////////////////
                /* istanbul ignore next */
                await action(h.path, {context: 'Daemon API'}, async () => {
                    const response = await h.handler(req.query as any as JSONObject)
                    if (response.format === 'html') {
                        res.end(response.html)
                    }
                    else {
                        res.json(response)
                    }
                }, async (err: Error) => {
                    await this._errorResponse(req, res, 500, err.message);
                });
                /////////////////////////////////////////////////////////////////////////
            })
        })

        this.#simplePostHandlers.forEach(h => {
            this.#app.post(h.path, async (req, res) => {
                /////////////////////////////////////////////////////////////////////////
                /* istanbul ignore next */
                await action(h.path, {context: 'Daemon API'}, async () => {
                    const reqData = req.body
                    if (!isJSONObject(reqData)) throw Error ('Not a JSONObject')
                    const response = await h.handler(reqData)
                    res.json(response)
                }, async (err: Error) => {
                    await this._errorResponse(req, res, 500, err.message);
                });
                /////////////////////////////////////////////////////////////////////////
            })
        })

        // /findFile - find a file (or feed) in the remote nodes. May return more than one.
        this.#app.post('/findFile', async (req, res) => {
            /////////////////////////////////////////////////////////////////////////
            /* istanbul ignore next */
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
            /* istanbul ignore next */
            await action('/loadFile', {context: 'Daemon API'}, async () => {
                await this._apiLoadFile(req, res)
            }, async (err: Error) => {
                res.status(500).send('Error loading file.');
            });
            /////////////////////////////////////////////////////////////////////////
        });
    }
    stop() {
        /* istanbul ignore next */
        if (this.#server) {
            this.#server.close()
        }
    }
    // async mockGetJson(path: string): Promise<JSONObject> {
    //     for (let h of this.#simpleGetHandlers) {
    //         if (h.path === path) {
    //             return await h.handler()
    //         }
    //     }
    //     throw Error(`Unexpected path in mockGetJson: ${path}`)
    // }
    async mockPostJson(path: string, data: JSONObject): Promise<JSONObject> {
        for (let h of this.#simplePostHandlers) {
            if (h.path === path) {
                return await h.handler(data)
            }
        }
        /* istanbul ignore next */
        throw Error(`Unexpected path in mockPostJson: ${path}`)
    }
    async mockPostLoadFile(data: JSONObject): Promise<DataStreamy> {
        /* istanbul ignore next */
        if (!isApiLoadFileRequest(data)) throw Error('Unexpected data in mockPostLoadFile')
        return await this._loadFile(data)
    }
    async mockPostFindFile(reqData: JSONObject): Promise<{
        onFound: (callback: (result: FindFileResult) => void) => void;
        onFinished: (callback: () => void) => void;
        cancel: () => void;
    }> {
        /* istanbul ignore next */
        if (!isApiFindFileRequest(reqData)) throw Error('Unexpected data in mockPostFindFile')
        return await this._findFile(reqData)
    }
    // /probe - check whether the daemon is up and running and return info such as the node ID
    /* istanbul ignore next */
    async _handleProbe(): Promise<JSONObject> {
        const joinedChannels = this.#node.joinedChannels()
        const response: DaemonApiProbeResponse = {
            success: true,
            protocolVersion: protocolVersion(),
            daemonVersion: daemonVersion(),
            nodeId: this.#node.nodeId(),
            isBootstrapNode: this.#node.isBootstrapNode(),
            webSocketAddress: this.#node.webSocketAddress(),
            publicUdpSocketAddress: this.#node.publicUdpSocketAddress(),
            joinedChannels,
            kacheryStorageDir: this.#node.kacheryStorageManager().storageDir()
        }
        /* istanbul ignore next */
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        return response
    }
    // /storeFile - store local file in local kachery storage
    /* istanbul ignore next */
    async _handleStoreFile(reqData: JSONObject): Promise<JSONObject> {
        if (!isStoreFileRequestData(reqData)) throw Error('Unexpected request data for storeFile.')
        
        const {sha1, manifestSha1} = await this.#node.kacheryStorageManager().storeLocalFile(reqData.localFilePath)
        const response: StoreFileResponseData = {
            success: true,
            error: null,
            sha1,
            manifestSha1
        }
        /* istanbul ignore next */
        if (!isJSONObject(response)) throw Error('Unexpected json object in _handleStoreFile')
        return response
    }
    // /halt - halt the kachery-p2p daemon (stops the server process)
    /* istanbul ignore next */
    async _handleHalt(): Promise<JSONObject> {
        interface ApiHaltResponse {
            success: boolean
        };
        this.stop()
        const response: ApiHaltResponse = { success: true };
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        setTimeout(() => {
            process.exit()
        }, durationMsecToNumber(scaledDurationMsec(3000)))
        return response
    }
    // /stats
    async _handleStats(query: JSONObject): Promise<JSONObject> {
        /* istanbul ignore next */
        if (!isGetStatsOpts(query)) throw Error('Unexpected query.')
        interface ApiStatsResponse {
            success: boolean,
            format: string,
            html?: string,
            stats: NodeStatsInterface
        }
        const stats = this.#node.getStats(query)
        const response: ApiStatsResponse = {
            success: true,
            format: (query.format || 'json') as string,
            html: stats.html,
            stats
        }
        /* istanbul ignore next */
        if (!isJSONObject(response)) throw Error('Unexpected json object in _handleStats')
        return response
    }
    // /findFile - find a file (or feed) locally or in the remote nodes. May return more than one.
    /* istanbul ignore next */
    async _apiFindFile(req: Req, res: Res) {
        const reqData = req.body
        /* istanbul ignore next */
        if (!isApiFindFileRequest(reqData)) throw Error('Invalid request in _apiFindFile')
        
        const x = await this._findFile(reqData)

        const jsonSocket = new JsonSocket(res as any as Socket)

        let isDone = false
        x.onFound((result: FindFileResult) => {
            if (isDone) return
            // may return more than one result
            // we send them one-by-one
            jsonSocket.sendMessage(result, () => {})
        });
        x.onFinished(() => {
            if (isDone) return
            // we are done
            isDone = true
            res.end()
        })
        req.on('close', () => {
            // if the request socket is closed, we cancel the find request
            isDone = true
            x.cancel()
        });
    }
    async _findFile(reqData: ApiFindFileRequest) {
        const { fileKey, timeoutMsec } = reqData
        return this.#node.findFile({fileKey, timeoutMsec})
    }
    // /loadFile - load a file from remote kachery node(s) and store in kachery storage
    /* istanbul ignore next */
    async _apiLoadFile(req: Req, res: Res) {
        const jsonSocket = new JsonSocket(res as any as Socket)
        let x: DataStreamy
        const apiLoadFileRequest = req.body
        if (!isApiLoadFileRequest(apiLoadFileRequest)) {
            jsonSocket.sendMessage({type: 'error', error: 'Invalid api load file request'}, () => {})
            res.end()
            return
        }
        try {
            x = await this._loadFile(apiLoadFileRequest)
        }
        catch(err) {
            jsonSocket.sendMessage({type: 'error', error: err.message}, () => {})
            res.end()
            return
        }
        let isDone = false
        x.onFinished(() => {
            if (isDone) return
            // we are done
            const localFilePath = apiLoadFileRequest.fileKey.sha1
            this.#node.kacheryStorageManager().findFile(apiLoadFileRequest.fileKey).then(({found, size, localFilePath}) => {
                if (isDone) return
                if (found) {
                    if (localFilePath) {
                        isDone = true
                        jsonSocket.sendMessage({type: 'finished', localFilePath}, () => {})
                        res.end()
                    }
                    else {
                        isDone = true
                        jsonSocket.sendMessage({type: 'error', error: 'Unexpected: load completed, but localFilePath is null.'}, () => {})
                        res.end()
                    }
                }
                else {
                    isDone = true
                    jsonSocket.sendMessage({type: 'error', error: 'Unexpected: did not find file in local kachery storage even after load completed'}, () => {})
                    res.end()
                }
            })
        });
        x.onError((err) => {
            if (isDone) return
            isDone = true
            jsonSocket.sendMessage({type: 'error', error: err.message}, () => {})
            res.end()
        });
        x.onProgress((prog) => {
            jsonSocket.sendMessage({
                type: 'progress',
                bytesLoaded: prog.bytesLoaded,
                bytesTotal: prog.bytesTotal
            }, () => {})
        });
        req.on('close', () => {
            // if the request socket is closed, we cancel the load request
            isDone = true
            x.cancel()
        });
    }
    async _loadFile(reqData: ApiLoadFileRequest) {
        /* istanbul ignore next */
        if (!isApiLoadFileRequest(reqData)) throw Error('Invalid request in _apiLoadFile');

        const { fileKey, fromNode } = reqData;
        if (fileKey.manifestSha1) {
            console.info(`Loading file: sha1://${fileKey.sha1}?manifest=${fileKey.manifestSha1}`)
        }
        else {
            console.info(`Loading file: sha1://${fileKey.sha1}`)
        }        
        const x = await loadFile(
            this.#node,
            fileKey,
            {fromNode, label: fileKey.sha1.toString().slice(0, 5)}
        )
        return x
    }
    // /feed/createFeed - create a new writeable feed on this node
    async _handleFeedApiCreateFeed(reqData: any) {
        /* istanbul ignore next */
        if (!isFeedApiCreateFeedRequest(reqData)) throw Error('Invalid request in _feedApiCreateFeed');

        const feedName = reqData.feedName || null;
        const feedId = await this.#node.feedManager().createFeed({feedName});
        const response: FeedApiCreateFeedResponse = { success: true, feedId };
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        return response
    }
    // /feed/deleteFeed - delete feed on this node
    async _handleFeedApiDeleteFeed(reqData: JSONObject) {
        /* istanbul ignore next */
        if (!isFeedApiDeleteFeedRequest(reqData)) throw Error('Invalid request in _feedApiDeleteFeed');

        const { feedId } = reqData;
        await this.#node.feedManager().deleteFeed({feedId});

        const response: FeedApiDeleteFeedResponse = {success: true}
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        return response
    }
    // /feed/getFeedId - lookup the ID of a local feed based on its name
    async _handleFeedApiGetFeedId(reqData: JSONObject) {
        /* istanbul ignore next */
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
        return response
    }
    // /feed/appendMessages - append messages to a local writeable subfeed
    async _handleFeedApiAppendMessages(reqData: JSONObject) {
        /* istanbul ignore next */
        if (!isFeedApiAppendMessagesRequest(reqData)) throw Error('Invalid request in _feedApiAppendMessages')
        const { feedId, subfeedHash, messages } = reqData

        // CHAIN:append_messages:step(2)
        await this.#node.feedManager().appendMessages({
            feedId, subfeedHash, messages
        });

        const response: FeedApiAppendMessagesResponse = {success: true}
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object')
        return response
    }
    // /feed/submitMessage - submit message to a remote live subfeed (must have permission)
    async _handleFeedApiSubmitMessage(reqData: JSONObject) {
        /* istanbul ignore next */
        if (!isFeedApiSubmitMessageRequest(reqData)) throw Error('Invalid request in _feedApiSubmitMessage');

        const { feedId, subfeedHash, message, timeoutMsec } = reqData;

        await this.#node.feedManager().submitMessage({feedId, subfeedHash, message, timeoutMsec});

        const response: FeedApiSubmitMessageResponse = {success: true}
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        return response
    }
    // /feed/getNumLocalMessages - get number of messages in a subfeed
    async _handleFeedApiGetNumLocalMessages(reqData: JSONObject) {
        /* istanbul ignore next */
        if (!isFeedApiGetNumLocalMessagesRequest(reqData)) throw Error('Invalid request in _feedApiGetNumLocalMessages');

        const { feedId, subfeedHash } = reqData;

        const numMessages = await this.#node.feedManager().getNumLocalMessages({
            feedId, subfeedHash
        });

        const response: FeedApiGetNumLocalMessagesResponse = {success: true, numMessages}
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        return response
    }
    // /feed/getFeedInfo - get info for a feed - such as whether it is writeable
    async _handleFeedApiGetFeedInfo(reqData: JSONObject) {
        /* istanbul ignore next */
        if (!isFeedApiGetFeedInfoRequest(reqData)) throw Error('Invalid request in _feedApiGetFeedInfo');

        const { feedId, timeoutMsec } = reqData;
        const liveFeedInfo = await this.#node.feedManager().getFeedInfo({feedId, timeoutMsec});

        const response: FeedApiGetFeedInfoResponse = {success: true, isWriteable: liveFeedInfo.nodeId === this.#node.nodeId(), nodeId: liveFeedInfo.nodeId}
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        return response
    }
    // /feed/getAccessRules - get access rules for a local writeable subfeed
    async _handleFeedApiGetAccessRules(reqData: JSONObject) {
        /* istanbul ignore next */
        if (!isFeedApiGetAccessRulesRequest(reqData)) throw Error('Invalid request in _feedApiGetAccessRules');

        const { feedId, subfeedHash } = reqData;

        const accessRules = await this.#node.feedManager().getAccessRules({feedId, subfeedHash});
        let response: FeedApiGetAccessRulesResponse;
        if (accessRules) {
            response = {success: true, accessRules}
        }
        else {
            response = {success: false, accessRules: null}
        };
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        return response
    }
    // /feed/setAccessRules - set access rules for a local writeable subfeed
    async _handleFeedApiSetAccessRules(reqData: JSONObject) {
        /* istanbul ignore next */
        if (!isFeedApiSetAccessRulesRequest(reqData)) throw Error('Invalid request in _feedApiSetAccessRules');

        const { feedId, subfeedHash, accessRules } = reqData;

        await this.#node.feedManager().setAccessRules({feedId, subfeedHash, accessRules})

        const response: FeedApiSetAccessRulesResponse = {success: true}
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        return response
    }
    // /feed/watchForNewMessages - wait until new messages have been appended to a list of watched subfeeds
    async _handleFeedApiWatchForNewMessages(reqData: JSONObject) {
        /* istanbul ignore next */
        if (!isFeedApiWatchForNewMessagesRequest(reqData)) throw Error('Invalid request in _feedApiWatchForNewMessages')

        const { subfeedWatches, waitMsec, maxNumMessages, signed } = reqData

        const messages = await this.#node.feedManager().watchForNewMessages({
            subfeedWatches: toSubfeedWatchesRAM(subfeedWatches), waitMsec, maxNumMessages: maxNumMessages || messageCount(0), signed: signed || false
        })

        const response: FeedApiWatchForNewMessagesResponse = {success: true, messages: mapToObject(messages)}
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object')
        return response
    }
    // Helper function for returning http request with an error response
    /* istanbul ignore next */
    async _errorResponse(req: Req, res: Res, code: number, errorString: string) {
        console.info(`Daemon responding with error: ${code} ${errorString}`);
        try {
            res.status(code).send(errorString);
        }
        catch(err) {
            console.warn(`Problem sending error`, {error: err.message});
        }
        await sleepMsec(scaledDurationMsec(100));
        try {
            req.connection.destroy();
        }
        catch(err) {
            console.warn('Problem destroying connection', {error: err.message});
        }
    }
    // Start listening via http/https
    async listen(port: Port) {
        this.#server = await this.#node.externalInterface().startHttpServer(this.#app, port)
    }
}

const isLocalRequest = (req: Request) => {
    return (req.socket.localAddress === req.socket.remoteAddress);
}