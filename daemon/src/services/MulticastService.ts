import dgram from 'dgram';
import { action } from "../action";
import { getSignature, verifySignature } from "../common/crypto_util";
import { sleepMsec } from "../common/util";
import { isMulticastAnnounceMessage, JSONObject, MulticastAnnounceMessage, MulticastAnnounceMessageBody, nodeIdToPublicKey, tryParseJsonObject } from "../interfaces/core";
import { AnnounceRequestData } from "../interfaces/NodeToNodeRequest";
import KacheryP2PNode from "../KacheryP2PNode";
import { protocolVersion } from "../protocolVersion";

export default class MulticastService {
    #node: KacheryP2PNode
    constructor(node: KacheryP2PNode) {
        this.#node = node
        this._start();
    }
    async _start() {
        // to find nodes on the local network
        const multicastSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });
        const multicastAddress = '237.0.0.0'; // not sure how to choose this
        const multicastPort = 21010;
        multicastSocket.bind(multicastPort);
        multicastSocket.on("listening", function() {
            multicastSocket.addMembership(multicastAddress);
        });
        multicastSocket.on("message", (message, rinfo) => {
            let msg: JSONObject | null = tryParseJsonObject(message.toString());
            if (isMulticastAnnounceMessage(msg)) {
                const msg2: MulticastAnnounceMessage = msg;
                action('handleMulticastAnnounceMessage', {fromNodeId: msg.body.fromNodeId}, async () => {
                    if (verifySignature(msg2.body, msg2.signature, nodeIdToPublicKey(msg2.body.fromNodeId), {checkTimestamp: true})) {
                        const response = this.#node._handleAnnounceRequest({ fromNodeId: msg2.body.fromNodeId, requestData: msg2.body.requestData });
                        // don't do anything with response here
                    }
                }, async (err: Error) => {
                    //
                });
            }
        });
        await sleepMsec(1000);
        while (true) {
            for (let channelName of this.#node.channelNames()) {
                const requestData: AnnounceRequestData = {
                    requestType: 'announce',
                    channelNodeInfo: this.#node.getChannelNodeInfo(channelName)
                }
                const body: MulticastAnnounceMessageBody = {
                    protocolVersion: protocolVersion(),
                    fromNodeId: this.#node.nodeId(),
                    messageType: 'announce',
                    requestData
                };
                const m: MulticastAnnounceMessage = {
                    body,
                    signature: getSignature(body, this.#node.keyPair())
                };
                const mJson: string = JSON.stringify(m);
                action('sendMulticastAnnounceMessage', {}, async () => {
                    multicastSocket.send(
                        mJson,
                        0,
                        mJson.length,
                        multicastPort,
                        multicastAddress
                    );
                }, async () => {
                })
            }
            await sleepMsec(12000);
        }
    }
}
