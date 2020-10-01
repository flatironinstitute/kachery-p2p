import fs from 'fs'
import { createKeyPair, getSignature, verifySignature, publicKeyToHex, hexToPublicKey, hexToPrivateKey, privateKeyToHex } from './common/crypto_util';
import FeedManager from './FeedManager';
import { PublicKey, Address, ChannelName, KeyPair, NodeId, Port, PrivateKey, FileKey, publicKeyHexToNodeId, SubfeedHash, FeedId, FindLiveFeedResult, SignedSubfeedMessage, FindFileResult, nowTimestamp, nodeIdToPublicKey, SubmittedSubfeedMessage, errorMessage, HostName, ChannelInfo, ChannelNodeInfoBody, ChannelNodeInfo } from './interfaces/core';
import RemoteNodeManager from './RemoteNodeManager';
import { isAddress } from './interfaces/core';

import { createStreamId, DownloadFileDataRequestData, DownloadFileDataResponseData, isCheckForLiveFeedResponseData, isDownloadFileDataRequestData, isGetLiveFeedSignedMessagesResponseData, isSubmitMessageToLiveFeedResponseData, NodeToNodeRequest, NodeToNodeResponse, NodeToNodeResponseData, StreamId, SubmitMessageToLiveFeedRequestData } from './interfaces/NodeToNodeRequest';
import { isAnnounceRequestData, AnnounceRequestData, AnnounceResponseData } from './interfaces/NodeToNodeRequest';
import { isGetChannelInfoRequestData, GetChannelInfoRequestData, GetChannelInfoResponseData } from './interfaces/NodeToNodeRequest';
import { isCheckForFileRequestData, CheckForFileRequestData, CheckForFileResponseData } from './interfaces/NodeToNodeRequest';
import { isCheckForLiveFeedRequestData, CheckForLiveFeedRequestData, CheckForLiveFeedResponseData } from './interfaces/NodeToNodeRequest';
import { isSetLiveFeedSubscriptionsRequestData, SetLiveFeedSubscriptionsRequestData, SetLiveFeedSubscriptionsResponseData } from './interfaces/NodeToNodeRequest';
import { isGetLiveFeedSignedMessagesRequestData, GetLiveFeedSignedMessagesRequestData, GetLiveFeedSignedMessagesResponseData } from './interfaces/NodeToNodeRequest';
import { LiveFeedSubscriptionManager } from './LiveFeedSubscriptionManager';
import { KacheryStorageManager } from './KacheryStorageManager';
import { ProxyConnectionToClient } from './ProxyConnectionToClient';
import RemoteNode from './RemoteNode';
import { protocolVersion } from './protocolVersion';
import GarbageMap from './common/GarbageMap';

interface LoadFileProgress {
    bytesLoaded: bigint,
    bytesTotal: bigint,
    nodeId: NodeId | null
}

class KacheryP2PNode {
    #keyPair: KeyPair
    #nodeId: NodeId
    #feedManager: FeedManager
    #channelNames: ChannelName[]
    #remoteNodeManager: RemoteNodeManager
    #kacheryStorageManager: KacheryStorageManager
    #liveFeedSubscriptionManager: LiveFeedSubscriptionManager
    #proxyConnectionsToClients = new Map<NodeId, ProxyConnectionToClient>()
    #bootstrapAddresses: Address[] // not same as argument to constructor
    #downloadStreamInfos = new GarbageMap<StreamId, DownloadFileDataRequestData>(30 * 60 * 1000)
    constructor(private p : {
        configDir: string,
        verbose: number,
        hostName: HostName | null,
        httpListenPort: Port | null,
        webSocketListenPort: Port | null,
        label: string,
        bootstrapAddresses: Address[] | null,
        channelNames: ChannelName[],
        opts: {noBootstrap: boolean, isBootstrapNode: boolean}
    }) {
        const { publicKey, privateKey } = _loadKeypair(this.p.configDir); // The keypair for signing messages and the public key is used as the node id
        this.#keyPair = {publicKey, privateKey}; // the keypair
        this.#nodeId = publicKeyHexToNodeId(publicKeyToHex(this.#keyPair.publicKey)); // get the node id from the public key
        this.#kacheryStorageManager = new KacheryStorageManager();
        this.#liveFeedSubscriptionManager = new LiveFeedSubscriptionManager();

        // The feed manager -- each feed is a collection of append-only logs
        this.#feedManager = new FeedManager(this);

        this.#remoteNodeManager = new RemoteNodeManager(this);

        let bootstrapAddresses = this.p.bootstrapAddresses;
        if (!this.p.opts.noBootstrap) {
            if (bootstrapAddresses === null) {
                bootstrapAddresses = [
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
                    if ((bpi.hostName === 'localhost') || (bpi.hostName === this.p.hostName)) {
                        if (bpi.port === this.p.httpListenPort) {
                            return false;
                        }
                    }
                    return true;
                });
            }
        }
        this.#bootstrapAddresses = bootstrapAddresses || []
    }
    nodeId() {
        return this.#nodeId;
    }
    channelNames() {
        return [...this.#channelNames];
    }
    keyPair() {
        return this.#keyPair
    }
    remoteNodeManager() {
        return this.#remoteNodeManager
    }
    bootstrapAddresses() {
        return [...this.#bootstrapAddresses]
    }
    isBootstrapNode() {
        return this.p.opts.isBootstrapNode;
    }
    findFile(args: {fileKey: FileKey, timeoutMsec: number}): {
        onFound: (callback: (result: FindFileResult) => void) => void,
        onFinished: (callback: () => void) => void,
        cancel: () => void
    } {
        const requestData: CheckForFileRequestData = {
            requestType: 'checkForFile',
            fileKey: args.fileKey
        };
        const {onResponse, onFinished, cancel} = this.#remoteNodeManager.sendRequestToNodesInChannels(requestData, {timeoutMsec: args.timeoutMsec, channelNames: this.#channelNames});
        const onFoundCallbacks: ((result: FindFileResult) => void)[] = [];
        const onFinishedCallbacks: (() => void)[] = [];
        onResponse((nodeId: NodeId, responseData: NodeToNodeResponseData) => {
            if (!isCheckForFileRequestData(responseData)) {
                throw Error('Unexpected response type.');
            }
            const { found, size } = responseData;
            if ((found) && (size !== null)) {
                onFoundCallbacks.forEach(cb => {
                    cb({
                        nodeId,
                        fileKey: args.fileKey,
                        fileSize: size
                    })
                })
            }
        })
        onFinished(() => {
            onFinishedCallbacks.forEach(cb => {
                cb();
            });
        })
        return {
            onFound: (cb) => {
                onFoundCallbacks.push(cb);
            },
            onFinished: (cb) => {
                onFinishedCallbacks.push(cb);
            },
            cancel: () => {
                cancel();
            }
        }
    }
    loadFile(args: {fileKey: FileKey, opts: {fromNode: NodeId | undefined, fromChannel: ChannelName | undefined}}): {
        onFinished: (callback: () => void) => void,
        onProgress: (callback: (progress: LoadFileProgress) => void) => void,
        onError: (callback: (err: Error) => void) => void,
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
    setProxyConnectionToClient(nodeId: NodeId, c: ProxyConnectionToClient) {
        if (this.#proxyConnectionsToClients.has(nodeId)) {
            // we already have this connection
            c.close();
            return;
        }
        this.#proxyConnectionsToClients.set(nodeId, c);
        c.onClosed(() => {
            if (this.#proxyConnectionsToClients.get(nodeId) === c) {
                this.#proxyConnectionsToClients.delete(nodeId);
            }
        })
    }
    getChannelInfo(channelName: ChannelName): ChannelInfo {
        const remoteNodesInChannel: RemoteNode[] = this.#remoteNodeManager.getRemoteNodesInChannel(channelName)
        const x: ChannelInfo = {
            nodes: remoteNodesInChannel.map(n => {
                return n.getChannelNodeInfo(channelName)
            }).filter(channelInfo => (channelInfo !== null))
            .map(channelInfo => {
                if (channelInfo === null) {
                    throw Error('Unexpected channelInfo === null should have been filtered out')
                }
                return channelInfo;
            })
        }
        return x;
    }
    httpAddress(): Address | null {
        return (this.p.hostName !== null) && (this.p.httpListenPort !== null) ? {hostName: this.p.hostName, port: this.p.httpListenPort} : null
    }
    webSocketAddress(): Address | null {
        return (this.p.hostName !== null) && (this.p.webSocketListenPort !== null) ? {hostName: this.p.hostName, port: this.p.webSocketListenPort} : null
    }
    getChannelNodeInfo(channelName: ChannelName): ChannelNodeInfo {
        const body = {
            channelName,
            nodeId: this.#nodeId,
            httpAddress: this.httpAddress(),
            webSocketAddress: this.webSocketAddress(),
            udpAddress: null, // todo
            proxyHttpAddresses: [], // todo
            timestamp: nowTimestamp()
        }
        return {
            body,
            signature: getSignature(body, this.#keyPair)
        }
    }
    async getRemoteLiveFeedSignedMessages(args: {
        nodeId: NodeId,
        feedId: FeedId,
        subfeedHash: SubfeedHash,
        position: number,
        maxNumMessages: number,
        waitMsec: number
    }): Promise<SignedSubfeedMessage[]> {
        const { nodeId, feedId, subfeedHash, position, maxNumMessages, waitMsec } = args;
        const requestData: GetLiveFeedSignedMessagesRequestData = {
            requestType: 'getLiveFeedSignedMessages',
            feedId,
            subfeedHash,
            position,
            maxNumMessages,
            waitMsec
        }
        const responseData = await this.#remoteNodeManager.sendRequestToNode(nodeId, requestData, {timeoutMsec: waitMsec + 1000});
        if (!isGetLiveFeedSignedMessagesResponseData(responseData)) {
            throw Error('Unexpected response type.');
        }
        if (!responseData.success) {
            throw Error(`Error getting remote live feed signed messages: ${responseData.errorMessage}`);
        }
        const { signedMessages } = responseData;
        if (signedMessages === null) {
            throw Error('Unexpected: signedMessages is null.');
        }
        return signedMessages;
    }
    async submitMessageToRemoteLiveFeed({nodeId, feedId, subfeedHash, message, timeoutMsec}: {
        nodeId: NodeId,
        feedId: FeedId,
        subfeedHash: SubfeedHash,
        message: SubmittedSubfeedMessage,
        timeoutMsec: number
    }) {
        const requestData: SubmitMessageToLiveFeedRequestData = {
            requestType: 'submitMessageToLiveFeed',
            feedId,
            subfeedHash,
            message
        }
        const responseData = await this.#remoteNodeManager.sendRequestToNode(nodeId, requestData, {timeoutMsec: timeoutMsec});
        if (!isSubmitMessageToLiveFeedResponseData(responseData)) {
            throw Error(`Error submitting message to remote live feed: Unexpected response data.`);
        }
        if (!responseData.success) {
            throw Error(`Error submitting message to remote live feed: ${responseData.errorMessage}`);
        }
    }
    async findLiveFeed(args: {
        feedId: FeedId,
        timeoutMsec: number
    }): Promise<FindLiveFeedResult | null> {
        const {feedId, timeoutMsec} = args;
        return new Promise<FindLiveFeedResult | null>((resolve, reject) => {
            const requestData: CheckForLiveFeedRequestData = {
                requestType: 'checkForLiveFeed',
                feedId
            }
            const {onResponse, onFinished, cancel} = this.#remoteNodeManager.sendRequestToNodesInChannels(requestData, {timeoutMsec, channelNames: this.#channelNames});
            let found = false;
            onResponse((nodeId, responseData) => {
                if (found) return;
                if (!isCheckForLiveFeedResponseData(responseData)) {
                    throw Error('Unexpected response type.');
                }
                if (responseData.found) {
                    found = true;
                    resolve({
                        nodeId
                    })
                }
            });
            onFinished(() => {
                if (!found) {
                    resolve(null);
                }
            });
        });
    }
    async handleNodeToNodeRequest(request: NodeToNodeRequest): Promise<NodeToNodeResponse> {
        const { requestId, fromNodeId, toNodeId, timestamp, requestData } = request.body;
        if (!verifySignature(request.body, request.signature, nodeIdToPublicKey(fromNodeId))) {
            // todo: is this the right way to handle this situation?
            throw Error('Invalid signature in node-to-node request');
        }
        if (toNodeId !== this.#nodeId) {
            // redirect request to a different node
            const p = this.#proxyConnectionsToClients.get(toNodeId);
            if (!p) {
                throw Error('No proxy connection to node.');
            }
            return await p.sendRequest(request);
        }
        
        let responseData: NodeToNodeResponseData;
        if (isGetChannelInfoRequestData(requestData)) {
            responseData = await this._handleGetChannelInfoRequest({fromNodeId, requestData});
        }
        else if (isAnnounceRequestData(requestData)) {
            responseData = await this._handleAnnounceRequest({fromNodeId, requestData});
        }
        else if (isCheckForFileRequestData(requestData)) {
            responseData = await this._handleCheckForFileRequest({fromNodeId, requestData});
        }
        else if (isCheckForLiveFeedRequestData(requestData)) {
            responseData = await this._handleCheckForLiveFeedRequest({fromNodeId, requestData});
        }
        else if (isSetLiveFeedSubscriptionsRequestData(requestData)) {
            responseData = await this._handleSetLiveFeedSubscriptionsRequest({fromNodeId, requestData});
        }
        else if (isGetLiveFeedSignedMessagesRequestData(requestData)) {
            responseData = await this._handleGetLiveFeedSignedMessagesRequest({fromNodeId, requestData});
        }
        else if (isDownloadFileDataRequestData(requestData)) {
            responseData = await this._handleDownloadFileDataRequest({fromNodeId, requestData})
        }
        else {
            console.warn(requestData);
            throw Error('Unexpected error: unrecognized request data.')
        }
        const body = {
            protocolVersion: protocolVersion(),
            requestId,
            fromNodeId: this.#nodeId,
            toNodeId: fromNodeId,
            timestamp: nowTimestamp(),
            responseData: responseData
        };
        return {
            body,
            signature: getSignature(body, this.#keyPair)
        }
    }
    async _handleGetChannelInfoRequest({fromNodeId, requestData} : {fromNodeId: NodeId, requestData: GetChannelInfoRequestData}): Promise<GetChannelInfoResponseData> {
        const { channelName } = requestData;
        const channelInfo = await this.#remoteNodeManager.getChannelInfo(channelName);
        return {
            requestType: 'getChannelInfo',
            channelInfo
        }
    }
    async _handleAnnounceRequest({fromNodeId, requestData} : {fromNodeId: NodeId, requestData: AnnounceRequestData}): Promise<AnnounceResponseData> {
        return await this.#remoteNodeManager.handleAnnounceRequest({fromNodeId, requestData});
    }
    async _handleCheckForFileRequest({fromNodeId, requestData} : {fromNodeId: NodeId, requestData: CheckForFileRequestData}): Promise<CheckForFileResponseData> {
        const { fileKey } = requestData;
        const {found, size} = await this.#kacheryStorageManager.hasFile(fileKey);
        return {
            requestType: 'checkForFile',
            found,
            size
        }
    }
    async _handleCheckForLiveFeedRequest({fromNodeId, requestData} : {fromNodeId: NodeId, requestData: CheckForLiveFeedRequestData}): Promise<CheckForLiveFeedResponseData> {
        const { feedId } = requestData;
        const found = await this.#feedManager.hasWriteableFeed({feedId});
        return {
            requestType: 'checkForLiveFeed',
            found
        }
    }
    async _handleSetLiveFeedSubscriptionsRequest({fromNodeId, requestData} : {fromNodeId: NodeId, requestData: SetLiveFeedSubscriptionsRequestData}): Promise<SetLiveFeedSubscriptionsResponseData> {
        const { liveFeedSubscriptions } = requestData;
        await this.#liveFeedSubscriptionManager.setSubscriptions({nodeId: fromNodeId, subscriptions: liveFeedSubscriptions});
        return {
            requestType: 'setLiveFeedSubscriptions',
            success: true
        }
    }
    async _handleGetLiveFeedSignedMessagesRequest({fromNodeId, requestData} : {fromNodeId: NodeId, requestData: GetLiveFeedSignedMessagesRequestData}): Promise<GetLiveFeedSignedMessagesResponseData> {
        const { feedId, subfeedHash, position, maxNumMessages, waitMsec } = requestData;
        const hasLiveFeed = await this.#feedManager.hasWriteableFeed({feedId});
        if (!hasLiveFeed) {
            return {
                requestType: 'getLiveFeedSignedMessages',
                success: false,
                errorMessage: errorMessage('Live feed not found.'),
                signedMessages: null
            }
        }
        const signedMessages = await this.#feedManager.getSignedMessages({feedId, subfeedHash, position, maxNumMessages, waitMsec});
        return {
            requestType: 'getLiveFeedSignedMessages',
            success: true,
            errorMessage: null,
            signedMessages
        }
    }
    async _handleDownloadFileDataRequest({fromNodeId, requestData} : {fromNodeId: NodeId, requestData: DownloadFileDataRequestData}): Promise<DownloadFileDataResponseData> {
        const { fileKey, startByte, endByte } = requestData
        if ((startByte < 0) || (startByte >= endByte)) {
            return {
                requestType: 'downloadFileData',
                success: false,
                streamId: null,
                errorMessage: errorMessage('Invalid start/end bytes')
            }
        }
        const {found, size} = await this.#kacheryStorageManager.hasFile(fileKey);
        if (!found) {
            return {
                requestType: 'downloadFileData',
                success: false,
                streamId: null,
                errorMessage: errorMessage('Unable to find file')
            }
        }
        if (size === null) {
            throw Error('Unexpected')
        }
        if (endByte > size) {
            return {
                requestType: 'downloadFileData',
                success: false,
                streamId: null,
                errorMessage: errorMessage('Start/end bytes out of range')
            }
        }
        const streamId = createStreamId()
        this.#downloadStreamInfos.set(streamId, requestData)
        return {
            requestType: 'downloadFileData',
            success: true,
            streamId,
            errorMessage: null
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