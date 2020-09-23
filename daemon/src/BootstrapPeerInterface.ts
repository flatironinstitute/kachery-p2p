import { HostName } from "./interfaces/core.js";
import KacheryP2PNode from "./KacheryP2PNode.js";

interface Params {
    node: KacheryP2PNode,
    hostName: HostName,
    port
}

class BootstrapPeerInterface {
    #p: Params
    constructor(p: Params) {
        this.#p = p;
    }
}

export default BootstrapPeerInterface;