import { assert } from 'console';
import fs from 'fs'
import BootstrapPeerInterface from './BootstrapPeerInterface';
import { createKeyPair, getSignature, verifySignature, publicKeyToHex, hexToPublicKey, hexToPrivateKey, privateKeyToHex } from './common/crypto_util';
import { sleepMsec } from './common/util';
import FeedManager from './FeedManager';
import { PublicKey, Address, ChannelName, KeyPair, NodeId, Port, PrivateKey, FileKey, publicKeyHexToNodeId, SubfeedHash, FeedId, FindLiveFeedResult, SignedSubfeedMessage, FindFileResult } from './interfaces';
import RemoteNodeManager from './RemoteNodeManager';
import { isAddress } from './interfaces';

interface Params {
    configDir: string,
    verbose: number,
    httpAddress: Address,
    webSocketAddress: Address,
    label: string,
    bootstrapInfos: Address[] | null,
    channelNames: ChannelName[],
    opts: {noBootstrap: boolean}
}

// todo
interface LoadFileProgress {
    bytesLoaded: bigint,
    bytesTotal: bigint,
    nodeId: NodeId | null
}

class KacheryP2PNode {
    #p: Params
    #bootstrapPeerInterfaces: BootstrapPeerInterface[] = []
    #keyPair: KeyPair
    #nodeId: NodeId
    #halted: boolean
    #feedManager: FeedManager
    #channelNames: ChannelName[]
    #remoteNodeManager: RemoteNodeManager
    constructor(params : Params) {
        // todo: validate inputs
        this.#p = params;

        const { publicKey, privateKey } = _loadKeypair(this.#p.configDir); // The keypair for signing messages and the public key is used as the node id
        this.#keyPair = {publicKey, privateKey}; // the keypair
        this.#nodeId = publicKeyHexToNodeId(publicKeyToHex(this.#keyPair.publicKey)); // get the node id from the public key
        this.#halted = false; // Whether we have halted the daemon

        // The feed manager -- each feed is a collection of append-only logs
        this.#feedManager = new FeedManager(this);

        this.#remoteNodeManager = new RemoteNodeManager(this);

        let bootstrapInfos = this.#p.bootstrapInfos;

        if (!this.#p.opts.noBootstrap) {
            if (bootstrapInfos === null) {
                bootstrapInfos = [
                        {hostName: '45.33.92.31', port: <Port><any>46002}, // kachery-p2p-spikeforest
                        {hostName: '45.33.92.33', port: <Port><any>46002} // kachery-p2p-flatiron1
                ].map(bpi => {
                    if (isAddress(bpi)) {
                        return bpi;
                    }
                    else {
                        throw Error(`Not an address: ${bpi}`);
                    }
                }).filter(bpi => {
                    if ((bpi.hostName === 'localhost') || (bpi.hostName === this.#p.httpAddress.hostName)) {
                        if (bpi.port === this.#p.httpAddress.port) {
                            return false;
                        }
                    }
                    return true;
                });
            }

            for (let bpi of bootstrapInfos) {
                this.#bootstrapPeerInterfaces.push(new BootstrapPeerInterface({ // todo
                    node: this,
                    hostName: bpi.hostName,
                    port: bpi.port
                }));
            }
        }

        this._start();
    }
    nodeId() {
        return this.#nodeId;
    }
    channelNames() {
        return [...this.#channelNames];
    }
    halt() {
        this.#remoteNodeManager.halt();
        this.#halted = true;
        // todo: figure out what else we need to halt
    }
    findFile(args: {fileKey: FileKey, timeoutMsec: number | undefined}): {
        onFound: (callback: (result: FindFileResult) => void) => void,
        onFinished: (callback: () => void) => void,
        cancel: () => void
    } {
        // todo
        return {
            onFound: () => {},
            onFinished: () => {},
            cancel: () => {}
        }
    }
    loadFile(args: {fileKey: FileKey, opts: {fromNode: NodeId | undefined, fromChannel: ChannelName | undefined}}): {
        onFinished: (callback: () => void) => void,
        onProgress: (callback: (progress: LoadFileProgress) => void) => void,
        onError: (callback: (Error) => void) => void,
        cancel: () => void
    } {
        // todo
        return {
            onFinished: () => {},
            onProgress: () => {},
            onError: () => {},
            cancel: () => {}
        }
    }
    feedManager() {
        return this.#feedManager
    }
    async getLiveFeedSignedMessages(args: {
        channelName: ChannelName,
        nodeId: NodeId,
        feedId: FeedId,
        subfeedHash: SubfeedHash,
        position: number,
        waitMsec: number
    }): Promise<SignedSubfeedMessage[]> {
        // todo
        return [];
    }
    async submitMessagesToLiveFeed(args: {
        channelName: ChannelName,
        nodeId: NodeId,
        feedId: FeedId,
        subfeedHash: SubfeedHash,
        messages: Object[]
    }) {
        // todo
    }
    findLiveFeed(args: {
        feedId: FeedId,
        timeoutMsec: number
    }): {
        onFound: (callback: ((result: FindLiveFeedResult) => void)) => void,
        onFinished: (callback: (() => void)) => void,
        cancel: () => void
    } {
        // todo
        // todo
        return {
            onFound: () => {},
            onFinished: () => {},
            cancel: () => {}
        }
    }
    async handleNodeToNodeRequest(requestBody) {
        // todo
    }
    async _start() {
        while (true) {
            if (this.#halted) return;
            // maintenance goes here
            await sleepMsec(10000);
        }
    }
}

const _loadKeypair = (configDir): {publicKey: PublicKey, privateKey: PrivateKey} => {
    if (!fs.existsSync(configDir)) {
        throw Error(`Config directory does not exist: ${configDir}`);
    }
    const publicKeyPath = `${configDir}/public.pem`;
    const privateKeyPath = `${configDir}/private.pem`;
    if (fs.existsSync(publicKeyPath)) {
        if (!fs.existsSync(privateKeyPath)) {
            throw Error(`Public key file exists, but secret key file does not.`);
        }
    }
    else {
        const {publicKey, privateKey} = createKeyPair();
        fs.writeFileSync(publicKeyPath, str(publicKey), {encoding: 'utf-8'});
        fs.writeFileSync(privateKeyPath, str(privateKey), {encoding: 'utf-8'});
        fs.chmodSync(privateKeyPath, fs.constants.S_IRUSR | fs.constants.S_IWUSR);
    }
    
    const keyPair = {
        publicKey: fs.readFileSync(publicKeyPath, {encoding: 'utf-8'}),
        privateKey: fs.readFileSync(privateKeyPath, {encoding: 'utf-8'}),
    }
    testKeyPair(keyPair);
    return {
        publicKey: (keyPair.publicKey as any as PublicKey),
        privateKey: (keyPair.privateKey as any as PrivateKey)
    }
}

const testKeyPair = (keyPair) => {
    const signature = getSignature({test: 1}, keyPair);
    if (!verifySignature({test: 1}, signature, keyPair.publicKey)) {
        throw new Error('Problem testing public/private keys. Error verifying signature.');
    }
    if (hexToPublicKey(publicKeyToHex(keyPair.publicKey)) !== keyPair.publicKey) {
        console.warn(hexToPublicKey(publicKeyToHex(keyPair.publicKey)));
        console.warn(keyPair.publicKey);
        throw new Error('Problem testing public/private keys. Error converting public key to/from hex.');
    }
    if (hexToPrivateKey(privateKeyToHex(keyPair.privateKey)) !== keyPair.privateKey) {
        throw new Error('Problem testing public/private keys. Error converting private key to/from hex.');
    }
}

function str(x: any): string {return x as string}

export default KacheryP2PNode;