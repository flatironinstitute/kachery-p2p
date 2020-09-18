import KacheryP2PNode from "./KacheryP2PNode.js";

interface Params {
    node: KacheryP2PNode,
    hostName: string,
    port
}

class BootstrapPeerInterface {
    _p: Params
    constructor(params: Params) {
        this._p = params;
    }
}

export default BootstrapPeerInterface;