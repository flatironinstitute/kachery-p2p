import express, {Express, request} from 'express';
import start_http_server from './common/start_http_server.js';
import KacheryP2PNode from './KacheryP2PNode';
import { sleepMsec } from './common/util.js';
import { isNodeToNodeRequest, isStreamId, NodeToNodeRequest, NodeToNodeResponse, StreamId } from './interfaces/NodeToNodeRequest.js';
import { NodeId, Port, JSONObject, isJSONObject, _validateObject, isBoolean, isNodeId, isOneOf, isAddress, Address, isNull, ProtocolVersion, DaemonVersion, isProtocolVersion, isDaemonVersion } from './interfaces/core.js';
import { Socket } from 'net';
import { action } from './action.js';
import { daemonVersion, protocolVersion } from './protocolVersion.js';
import { ByteCount } from './udp/UdpCongestionManager.js';

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
    webSocketAddress: Address | null
};
export const isApiProbeResponse = (x: any): x is ApiProbeResponse => {
    return _validateObject(x, {
        success: isBoolean,
        protocolVersion: isProtocolVersion,
        daemonVersion: isDaemonVersion,
        nodeId: isNodeId,
        isBootstrapNode: isBoolean,
        webSocketAddress: isOneOf([isNull, isAddress])
    });
}

export default class PublicApiServer {
    #node: KacheryP2PNode
    #verbose: number
    #stopperCallbacks: (() => void)[]
    #app: Express
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
            await action('/probe', {context: 'Public API'}, async () => {
                await this._apiProbe(req, res) 
            }, async (err: Error) => {
                await this._errorResponse(req, res, 500, err.message);
            });
        });
        this.#app.post('/probe', async (req, res) => {
            await action('/probe', {context: 'Public API'}, async () => {
                await this._apiProbe(req, res) 
            }, async (err: Error) => {
                await this._errorResponse(req, res, 500, err.message);
            });
        });
        // /nodeToNodeRequest
        this.#app.post('/nodeToNodeRequest', async (req, res) => {
            const reqBody = req.body;
            if (!isNodeToNodeRequest(reqBody)) {
                await this._errorResponse(req, res, 500, 'Invalid node-to-node request');
                return;
            }
            reqBody.body.fromNodeId
            await action('/nodeToNodeRequest', {
                context: 'Public API',
                fromNodeId: reqBody.body.fromNodeId,
                requestType: reqBody.body.requestData.requestType
            }, async () => {
                await this._apiNodeToNodeRequest(reqBody, res) 
            }, async (err: Error) => {
                await this._errorResponse(req, res, 500, err.message);
            });
        });
        // /download
        this.#app.get('/download/:nodeId/:streamId', async (req, res) => {
            const streamId = req.params.streamId
            const nodeId = req.params.nodeId
            await action('/download', {
                context: 'Public API',
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
            req.params.streamId
        });
    }
    // /probe - check whether the daemon is up and running and return info such as the node ID
    async _apiProbe(req: Req, res: Res) {
        const response: ApiProbeResponse = {
            success: true,
            protocolVersion: protocolVersion(),
            daemonVersion: daemonVersion(),
            nodeId: this.#node.nodeId(),
            isBootstrapNode: this.#node.isBootstrapNode(),
            webSocketAddress: this.#node.webSocketAddress()
        };
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        res.json(response);
    }
    // /nodeToNodeRequest
    async _apiNodeToNodeRequest(reqBody: NodeToNodeRequest, res: Res) {
        const response: NodeToNodeResponse = await this.#node.handleNodeToNodeRequest(reqBody);
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        res.json(response);
    }
    // /download
    _apiDownload(nodeId: NodeId, streamId: StreamId, req: Req, res: Res) {
        const {onData, onStarted, onFinished, onError, cancel} = this.#node.streamFileData(nodeId, streamId)
        let started = false
        onStarted((size: ByteCount) => {
            started = true
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Length': size
            });
        })
        
        onData((data: Buffer) => {
            res.send(data)
        })
        onFinished(() => {
            res.end()
        })
        onError((err: Error) => {
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
            cancel()
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
        const stopper = {
            onStop: (cb: () => void) => {
                this.#stopperCallbacks.push(cb);
            }
        }
        start_http_server(this.#app, port, stopper);
    }
}