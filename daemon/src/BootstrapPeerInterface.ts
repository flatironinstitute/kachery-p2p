import { HostName } from "./interfaces.js";
import KacheryP2PNode from "./KacheryP2PNode.js";

interface Params {
    node: KacheryP2PNode,
    hostName: HostName,
    port
}

class BootstrapPeerInterface {
    _p: Params
    constructor(params: Params) {
        this._p = params;
    }
}

export default BootstrapPeerInterface;