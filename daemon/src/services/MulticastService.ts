import dgram from 'dgram'
import { action } from "../common/action"
import { getSignature, verifySignature } from "../common/crypto_util"
import { sleepMsec } from "../common/util"
import { ChannelName, ChannelNodeInfo, isMulticastAnnounceMessage, JSONObject, KeyPair, MulticastAnnounceMessage, MulticastAnnounceMessageBody, NodeId, nodeIdToPublicKey, tryParseJsonObject } from "../interfaces/core"
import { AnnounceRequestData, AnnounceResponseData } from "../interfaces/NodeToNodeRequest"
import { protocolVersion } from "../protocolVersion"
import { durationMsec, DurationMsec, durationMsecToNumber } from '../udp/UdpCongestionManager'

interface DgramSocket {
    bind: (port: number) => void,
    on: (eventName: 'listening' | 'message', callback: (() => void) | ((message: JSONObject, rinfo: any) => void)) => void,
    addMembership: (address: string) => void,
    send: (message: string, offset: number, length: number, port: number, address: string) => void
}

type DgramCreateSocket = (args: {type: 'udp4', reuseAddr: boolean}) => DgramSocket

interface KacheryP2PNodeInterface {
    nodeId: () => NodeId
    keyPair: () => KeyPair
    channelNames: () => ChannelName[]
    getChannelNodeInfo: (channelName: ChannelName) => ChannelNodeInfo
    _handleAnnounceRequest: (args: { fromNodeId: NodeId, requestData: AnnounceRequestData }) => Promise<AnnounceResponseData>
}

export default class MulticastService {
    #node: KacheryP2PNodeInterface
    #halted = false
    constructor(node: KacheryP2PNodeInterface, private opts: {intervalMsec: DurationMsec, dgramCreateSocket: DgramCreateSocket} = {intervalMsec: durationMsec(12000), dgramCreateSocket: dgram.createSocket}) {
        this.#node = node
        this._start()
    }
    stop() {
        this.#halted = true
    }
    async _start() {
        // to find nodes on the local network
        const multicastSocket = this.opts.dgramCreateSocket({ type: "udp4", reuseAddr: true })
        // const multicastSocket = dgram.createSocket({ type: "udp4", reuseAddr: true })
        const multicastAddress = '237.0.0.0' // not sure how to choose this
        const multicastPort = 21010
        multicastSocket.bind(multicastPort)
        multicastSocket.on("listening", function() {
            multicastSocket.addMembership(multicastAddress)
        })
        multicastSocket.on("message", (message, rinfo) => {
            let msg: JSONObject | null = tryParseJsonObject(message.toString())
            if (isMulticastAnnounceMessage(msg)) {
                const msg2: MulticastAnnounceMessage = msg
                /////////////////////////////////////////////////////////////////////////
                action('handleMulticastAnnounceMessage', {fromNodeId: msg.body.fromNodeId}, async () => {
                    if (verifySignature(msg2.body, msg2.signature, nodeIdToPublicKey(msg2.body.fromNodeId), {checkTimestamp: true})) {
                        const response = this.#node._handleAnnounceRequest({ fromNodeId: msg2.body.fromNodeId, requestData: msg2.body.requestData })
                        // don't do anything with response here
                    }
                }, async (err: Error) => {
                    //
                })
                /////////////////////////////////////////////////////////////////////////
            }
        })
        await sleepMsec(1000)
        while (true) {
            if (this.#halted) return
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
                }
                const m: MulticastAnnounceMessage = {
                    body,
                    signature: getSignature(body, this.#node.keyPair())
                }
                const mJson: string = JSON.stringify(m)
                /////////////////////////////////////////////////////////////////////////
                action('sendMulticastAnnounceMessage', {}, async () => {
                    multicastSocket.send(
                        mJson,
                        0,
                        mJson.length,
                        multicastPort,
                        multicastAddress
                    )
                }, async () => {
                })
                /////////////////////////////////////////////////////////////////////////
            }
            await sleepMsec(durationMsecToNumber(this.opts.intervalMsec))
        }
    }
}
