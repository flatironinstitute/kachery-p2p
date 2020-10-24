import express, { Express } from 'express';
import { Socket } from 'net';
import { action } from '../common/action';
import DataStreamy from '../common/DataStreamy';
import { sleepMsec } from '../common/util';
import { HttpServerInterface } from '../external/ExternalInterface';
import { Address, ByteCount, DaemonVersion, isAddress, isBoolean, isDaemonVersion, isJSONObject, isNodeId, isNull, isOneOf, isProtocolVersion, JSONObject, NodeId, Port, ProtocolVersion, scaledDurationMsec, _validateObject } from '../interfaces/core';
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
    writeHead: Function
}

export interface ApiProbeResponse {
    success: boolean,
    protocolVersion: ProtocolVersion,
    daemonVersion: DaemonVersion,
    nodeId: NodeId,
    isBootstrapNode: boolean,
    webSocketAddress: Address | null,
    publicUdpSocketAddress: Address | null
};
export const isApiProbeResponse = (x: any): x is ApiProbeResponse => {
    return _validateObject(x, {
        success: isBoolean,
        protocolVersion: isProtocolVersion,
        daemonVersion: isDaemonVersion,
        nodeId: isNodeId,
        isBootstrapNode: isBoolean,
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
                await this._errorResponse(req, res, 500, 'Invalid node-to-node request');
                return;
            }
            reqBody.body.fromNodeId
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
        this.#app.get('/download/:nodeId/:streamId', async (req, res) => {
            const streamId = req.params.streamId
            const nodeId = req.params.nodeId
            /////////////////////////////////////////////////////////////////////////
            await action('/download', {
                context: 'Public API',
                nodeId,
                streamId
            }, async () => {
                if (!isStreamId(streamId)) {
                    throw Error ('Invalid stream ID')
                }
                if (!isNodeId(nodeId)) {
                    throw Error ('Invalid node ID')
                }
                this._apiDownload(nodeId, streamId, req, res)
            }, async (err: Error) => {
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
                console.warn(JSON.stringify(data, null, 4))
                throw Error('Invalid data for node to node request')
            }
            const ret = await this._nodeToNodeRequest(data)
            return ret
        }
        else {
            throw Error(`mock unexpected path: ${path}`)
        }
    }
    async mockGetDownload(path: string): Promise<DataStreamy> {
        if (path.startsWith('/download/')) {
            const vals = path.split('/')
            const nodeId = vals[2]
            const streamId = vals[3]
            if (!isNodeId(nodeId)) {
                throw Error('Invalid node id in mock /download')
            }
            if (!isStreamId(streamId)) {
                throw Error('Invalid stream id in mock /download')
            }
            return this.#node.streamFileData(nodeId, streamId)
        }
        else {
            throw Error(`mock get download unexpected path: ${path}`)
        }
    }
    async _probe(): Promise<JSONObject> {
        const response: ApiProbeResponse = {
            success: true,
            protocolVersion: protocolVersion(),
            daemonVersion: daemonVersion(),
            nodeId: this.#node.nodeId(),
            isBootstrapNode: this.#node.isBootstrapNode(),
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
    _apiDownload(nodeId: NodeId, streamId: StreamId, req: Req, res: Res) {
        const ds = this.#node.streamFileData(nodeId, streamId)
        let started = false
        ds.onStarted((size: ByteCount) => {
            started = true
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Length': size
            });
        })
        
        ds.onData((data: Buffer) => {
            res.send(data)
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