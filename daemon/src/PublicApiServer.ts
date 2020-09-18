import express, {Express} from 'express';
import { validateObject } from './schema/index.js';
import start_http_server from './common/start_http_server.js';
import KacheryP2PNode from './KacheryP2PNode';
import { sleepMsec } from './common/util.js';

export default class PublicApiServer {
    _node: KacheryP2PNode
    _verbose: number
    _stopper_callbacks: (() => void)[]
    _app: Express
    // This is the public API server for communication between nodes
    constructor(node: KacheryP2PNode, opts: {verbose: number}={verbose: 0}) {
        this._node = node; // The kachery-p2p daemon
        this._verbose = opts.verbose
        this._app = express(); // the express app

        this._app.set('json spaces', 4); // when we respond with json, this is how it will be formatted
        // this._app.use(cors()); // in the future, if we want to do this
        this._app.use(express.json());

        this._app.all('/*', (req, res, next) => {
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
        // /nodeToNodeRequest
        this._app.post('/nodeToNodeRequest', async (req, res) => {
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
    async _apiProbe(req, res) {
        res.json({ success: true, nodeId: this._node.nodeId() });
    }
    // /nodeToNodeRequest
    async _apiNodeToNodeRequest(req, res) {
        const reqBody = req.body;
        validateObject(reqBody, '/NodeToNodeRequest');
        const response = await this._node.handleNodeToNodeRequest(reqBody);
        validateObject(response, 'NodeToNodeResponse');
        res.json(response);
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