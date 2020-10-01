import KacheryP2PNode from "./KacheryP2PNode";
import AnnounceService from "./services/AnnounceService";
import BootstrapService from "./services/BootstrapService";
import DiscoverService from "./services/DiscoverService";
import MulticastService from "./services/MulticastService";
import ProxyClientService from "./services/ProxyClientService";

export default class KacheryP2PController {
    #node: KacheryP2PNode
    #announceService: AnnounceService
    #discoverService: DiscoverService
    #bootstrapService: BootstrapService
    #proxyClientService: ProxyClientService
    #multicastService: MulticastService
    constructor(node: KacheryP2PNode) {
        this.#node = node
        this.#announceService = new AnnounceService(node)
        this.#discoverService = new DiscoverService(node)
        this.#bootstrapService = new BootstrapService(node)
        this.#proxyClientService = new ProxyClientService(node)
        this.#multicastService = new MulticastService(node)
    }
    node() {
        return this.#node
    }
}