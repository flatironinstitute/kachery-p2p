export interface Port extends Number {
    __port__: never // phantom type
}

export interface Address {
    hostName: string,
    port: Port
}
export interface PublicKey extends String {
    __publicKey__: never // phantom type so that we cannot assign directly to a string
}
export interface PrivateKey extends String {
    __privateKey__: never // phantom type
}
export interface PublicKeyHex extends String {
    __publicKeyHex__: never // phantom type so that we cannot assign directly to a string
}
export interface PrivateKeyHex extends String {
    __privateKeyHex__: never // phantom type
}
export interface Sha1Hash extends String {
    __sha1Hash__: never // phantom type
}
export interface KeyPair {
    publicKey: PublicKey,
    privateKey: PrivateKey
}
export interface Signature extends String {
    __signature__: never
}
export interface NodeId extends String {
    __nodeId__: never // phantom type
}
export interface ChannelName extends String {
    __channelName__: never // phantom type
}
export interface FeedId extends String {
    __feedId__: never // phantom type
}
export interface SubfeedHash extends String {
    __subfeedHash__: never
}
export interface FileKey extends Object {
    __fileKey__: never
}

export const feedIdToPublicKeyHex = (feedId: FeedId): PublicKeyHex => {
    return feedId as any as PublicKeyHex;
}

export const publicKeyHexToNodeId = (x: PublicKeyHex) : NodeId => {
    return x as any as NodeId;
}

export interface SignedMessage {
    signature: Signature
}

export const toStr = (x: PublicKey | PrivateKey | PublicKeyHex | PrivateKeyHex | Sha1Hash | Signature | NodeId | ChannelName | FeedId | SubfeedHash): string => {
    return x as any as string;
}

export interface FindLiveFeedResult {
    
}