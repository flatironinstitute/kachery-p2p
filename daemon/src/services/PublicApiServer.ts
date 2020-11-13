import express, { Express } from 'express';
import { Socket } from 'net';
import { action } from '../common/action';
import { JSONStringifyDeterministic } from '../common/crypto_util';
import DataStreamy from '../common/DataStreamy';
import { sleepMsec } from '../common/util';
import { HttpServerInterface } from '../external/ExternalInterface';
import { Address, byteCount, ByteCount, DaemonVersion, isAddress, isBoolean, isDaemonVersion, isEqualTo, isJSONObject, isNodeId, isNull, isOneOf, JSONObject, NodeId, Port, ProtocolVersion, scaledDurationMsec, _validateObject } from '../interfaces/core';
import { isNodeToNodeRequest, isStreamId, NodeToNodeRequest, NodeToNodeResponse, StreamId } from '../interfaces/NodeToNodeRequest';
import KacheryP2PNode from '../KacheryP2PNode';
import { daemonVersion, protocolVersion } from '../protocolVersion';

interface Req {
    body: any,
    on: (eventName: string, callback: () => void) => void,
    connection: Socket
}

interface Res {
    json: (obj: JSONObject) => void,
    end: () => void,
    status: (s: number) => Res,
    send: (x: any) => Res,
    writeHead: Function,
    write: (x: Buffer) => void
}

export interface PublicApiProbeResponse {
    success: boolean,
    protocolVersion: ProtocolVersion,
    daemonVersion: DaemonVersion,
    nodeId: NodeId,
    isBootstrapNode: boolean,
    isMessageProxy: boolean,
    isDataProxy: boolean,
    webSocketAddress: Address | null,
    publicUdpSocketAddress: Address | null
};
export const isPublicApiProbeResponse = (x: any): x is PublicApiProbeResponse => {
    return _validateObject(x, {
        success: isBoolean,
        protocolVersion: isEqualTo(protocolVersion()),
        daemonVersion: isDaemonVersion,
        nodeId: isNodeId,
        isBootstrapNode: isBoolean,
        isMessageProxy: isBoolean,
        isDataProxy: isBoolean,
        webSocketAddress: isOneOf([isNull, isAddress]),
        publicUdpSocketAddress: isOneOf([isNull, isAddress])
    });
}

export default class PublicApiServer {
    #node: KacheryP2PNode
    #verbose: number
    #app: Express
    // #server: http.Server | https.Server | null = null
    #server: HttpServerInterface | null = null
    // This is the public API server for communication between nodes
    constructor(node: KacheryP2PNode, opts: {verbose: number}={verbose: 0}) {
        this.#node = node; // The kachery-p2p daemon
        this.#verbose = opts.verbose
        this.#app = express(); // the express app

        this.#app.set('json spaces', 4); // when we respond with json, this is how it will be formatted
        // this.#app.use(cors()); // in the future, if we want to do this
        this.#app.use(express.json());

        this.#app.all('/*', (req, res, next) => {
            next();
        });

        // /probe - check whether the daemon is up and running and return info such as the node ID
        this.#app.get('/probe', async (req, res) => {
            /////////////////////////////////////////////////////////////////////////
            await action('/probe', {context: 'Public API'}, async () => {
                await this._apiProbe(req, res) 
            }, async (err: Error) => {
                await this._errorResponse(req, res, 500, err.message);
            });
            /////////////////////////////////////////////////////////////////////////
        });
        this.#app.post('/probe', async (req, res) => {
            /////////////////////////////////////////////////////////////////////////
            await action('/probe', {context: 'Public API'}, async () => {
                await this._apiProbe(req, res) 
            }, async (err: Error) => {
                await this._errorResponse(req, res, 500, err.message);
            });
            /////////////////////////////////////////////////////////////////////////
        });
        // /nodeToNodeRequest
        this.#app.post('/nodeToNodeRequest', async (req, res) => {
            const reqBody = req.body;
            if (!isNodeToNodeRequest(reqBody)) {
                if ((reqBody.body) && (reqBody.body.protocolVersion === protocolVersion())) {
                    await this._errorResponse(req, res, 500, 'Invalid node-to-node request');
                }
                return;
            }
            
            this.#node.stats().reportBytesReceived('http', reqBody.body.fromNodeId, byteCount(JSONStringifyDeterministic(reqBody).length))
            /////////////////////////////////////////////////////////////////////////
            await action('/nodeToNodeRequest', {
                context: 'Public API',
                fromNodeId: reqBody.body.fromNodeId,
                requestType: reqBody.body.requestData.requestType
            }, async () => {
                await this._apiNodeToNodeRequest(reqBody, res) 
            }, async (err: Error) => {
                await this._errorResponse(req, res, 500, err.message);
            });
            /////////////////////////////////////////////////////////////////////////
        });
        // /download
        this.#app.get('/download/:fromNodeId/:toNodeId/:streamId', async (req, res) => {
            const streamId = req.params.streamId
            const fromNodeId = req.params.fromNodeId
            const toNodeId = req.params.toNodeId
            /////////////////////////////////////////////////////////////////////////
            await action('/download', {
                context: 'Public API',
                fromNodeId,
                toNodeId,
                streamId
            }, async () => {
                if (!isStreamId(streamId)) {
                    /* istanbul ignore next */
                    throw Error ('Invalid stream ID')
                }
                if (!isNodeId(fromNodeId)) {
                    /* istanbul ignore next */
                    throw Error ('Invalid fromNodeId')
                }
                if (!isNodeId(toNodeId)) {
                    /* istanbul ignore next */
                    throw Error ('Invalid toNodeId')
                }
                await this._apiDownload(fromNodeId, toNodeId, streamId, req, res)
            }, async (err: Error) => {
                /* istanbul ignore next */
                await this._errorResponse(req, res, 500, err.message);
            });
            /////////////////////////////////////////////////////////////////////////
            req.params.streamId
        });
    }
    stop() {
        if (this.#server) {
            this.#server.close()
        }
    }
    async mockPostJson(path: string, data: JSONObject): Promise<JSONObject> {
        if (path === '/probe') {
            return await this._probe()
        }
        else if (path === '/NodeToNodeRequest') {
            if (!isNodeToNodeRequest(data)) {
                /* istanbul ignore next */
                console.warn(JSON.stringify(data, null, 4))
                /* istanbul ignore next */
                throw Error('Invalid data for node to node request')
            }
            const ret = await this._nodeToNodeRequest(data)
            return ret
        }
        else {
            /* istanbul ignore next */
            throw Error(`mock unexpected path: ${path}`)
        }
    }
    async mockGetDownload(path: string): Promise<DataStreamy> {
        if (path.startsWith('/download/')) {
            const vals = path.split('/')
            const fromNodeId = vals[2]
            const toNodeId = vals[3]
            const streamId = vals[4]
            if (!isNodeId(fromNodeId)) {
                /* istanbul ignore next */
                throw Error('Invalid from node id in mock /download')
            }
            if (!isNodeId(toNodeId)) {
                /* istanbul ignore next */
                throw Error('Invalid to node id in mock /download')
            }
            if (!isStreamId(streamId)) {
                /* istanbul ignore next */
                throw Error('Invalid stream id in mock /download')
            }
            const ds = await this.#node.streamFileData(fromNodeId, streamId)
            ds.onData(d => {
                this.#node.stats().reportBytesSent('http', fromNodeId, byteCount(d.length))
            })
            return ds
        }
        else {
            /* istanbul ignore next */
            throw Error(`mock get download unexpected path: ${path}`)
        }
    }
    async _probe(): Promise<JSONObject> {
        const response: PublicApiProbeResponse = {
            success: true,
            protocolVersion: protocolVersion(),
            daemonVersion: daemonVersion(),
            nodeId: this.#node.nodeId(),
            isBootstrapNode: this.#node.isBootstrapNode(),
            isMessageProxy: this.#node.isMessageProxy(),
            isDataProxy: this.#node.isDataProxy(),
            webSocketAddress: this.#node.webSocketAddress(),
            publicUdpSocketAddress: this.#node.publicUdpSocketAddress()
        };
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        return response
    }
    async _nodeToNodeRequest(reqBody: NodeToNodeRequest): Promise<JSONObject> {
        const response: NodeToNodeResponse = await this.#node.handleNodeToNodeRequest(reqBody);
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        return response
    }
    // /probe - check whether the daemon is up and running and return info such as the node ID
    async _apiProbe(req: Req, res: Res) {
        const response = await this._probe()
        res.json(response);
    }
    // /nodeToNodeRequest
    async _apiNodeToNodeRequest(reqBody: NodeToNodeRequest, res: Res) {
        const response = await this._nodeToNodeRequest(reqBody)
        res.json(response);
    }
    // /download
    async _apiDownload(fromNodeId: NodeId, toNodeId: NodeId, streamId: StreamId, req: Req, res: Res) {
        const ds = await this.#node.streamFileData(fromNodeId, streamId)
        let started = false
        ds.onStarted((size: ByteCount) => {
            started = true
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Length': size
            });
        })
        
        ds.onData((data: Buffer) => {
            this.#node.stats().reportBytesSent('http', toNodeId, byteCount(data.length))
            res.write(data)
        })
        ds.onFinished(() => {
            res.end()
        })
        ds.onError((err: Error) => {
            if (started) {
                console.warn(err)
                console.warn('Error in streaming file data')
                res.end()
            }
            else {
                res.status(500).send(err.message);
            }
        })
        req.on('close', () => {
            ds.cancel()
        });
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
        this.#server = await this.#node.externalInterface().startHttpServer(this.#app, port);
    }
}