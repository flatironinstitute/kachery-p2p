import express, {Express} from 'express';
import start_http_server from './common/start_http_server.js';
import KacheryP2PNode from './KacheryP2PNode';
import { sleepMsec } from './common/util.js';
import { isNodeToNodeRequest, NodeToNodeResponse } from './interfaces/NodeToNodeRequest.js';
import { NodeId, Port, JSONObject, isJSONObject } from './interfaces/core.js';
import { Socket } from 'net';

interface Req {
    body: any,
    on: (eventName: string, callback: () => void) => void,
    connection: Socket
}

interface Res {
    json: (obj: JSONObject) => void,
    end: () => void,
    status: (s: number) => Res,
    send: (x: any) => Res
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
            console.info('/probe');
            try {
                await this._apiProbe(req, res) 
            }
            catch(err) {
                await this._errorResponse(req, res, 500, err.message);
            }
        });
        // /nodeToNodeRequest
        this.#app.post('/nodeToNodeRequest', async (req, res) => {
            console.info('/nodeToNodeRequest');
            try {
                await this._apiNodeToNodeRequest(req, res)
            }
            catch(err) {
                await this._errorResponse(req, res, 500, err.message);
            }
        });
    }
    // /probe - check whether the daemon is up and running and return info such as the node ID
    async _apiProbe(req: Req, res: Res) {
        interface ApiProbeResponse {
            success: boolean,
            nodeId: NodeId
        };
        const response: ApiProbeResponse = {success: true, nodeId: this.#node.nodeId()};
        if (!isJSONObject(response)) throw Error('Unexpected, not a JSON-serializable object');
        res.json(response);
    }
    // /nodeToNodeRequest
    async _apiNodeToNodeRequest(req: Req, res: Res) {
        const reqBody = req.body;
        if (!isNodeToNodeRequest(reqBody)) throw Error('Error in NodeToNode request');
        const response: NodeToNodeResponse = await this.#node.handleNodeToNodeRequest(reqBody);
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
        const stopper = {
            onStop: (cb: () => void) => {
                this.#stopperCallbacks.push(cb);
            }
        }
        await start_http_server(this.#app, port, stopper);
    }
}