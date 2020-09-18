import { Address } from "./interfaces";

class RemoteNode {
    #bootstrapPeerInfo: Address | null = null
    #halted: boolean = false;
    constructor() {
        this._start();
    }
    bootstrapPeerInfo() {
        return this.#bootstrapPeerInfo;
    }
    halt() {
        this.#halted = true;
    }
    async _start() {
        
    }
}

export default RemoteNode;