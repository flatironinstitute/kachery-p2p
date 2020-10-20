import { action } from "../common/action"
import { getSignature, verifySignature } from "../common/crypto_util"
import { sleepMsec } from "../common/util"
import { DgramSocket } from "../external/ExternalInterface"
import { Address, ChannelName, ChannelNodeInfo, DurationMsec, durationMsecToNumber, hostName, isMulticastAnnounceMessage, JSONObject, KeyPair, MulticastAnnounceMessage, MulticastAnnounceMessageBody, NodeId, nodeIdToPublicKey, nowTimestamp, Port, tryParseJsonObject } from "../interfaces/core"
import { AnnounceRequestData, AnnounceResponseData } from "../interfaces/NodeToNodeRequest"
import { protocolVersion } from "../protocolVersion"

interface KacheryP2PNodeInterface {
    nodeId: () => NodeId
    udpListenPort: () => Port | null
    keyPair: () => KeyPair
    channelNames: () => ChannelName[]
    getChannelNodeInfo: (channelName: ChannelName) => ChannelNodeInfo
    _handleAnnounceRequest: (args: { fromNodeId: NodeId, requestData: AnnounceRequestData, localUdpAddress: Address | null }) => Promise<AnnounceResponseData>
    dgramCreateSocket: (args: {type: 'udp4', reuseAddr: boolean}) => DgramSocket
    useMulticastUdp: () => boolean
}

export default class MulticastService {
    #node: KacheryP2PNodeInterface
    #halted = false
    constructor(node: KacheryP2PNodeInterface, private opts: {intervalMsec: DurationMsec, multicastAddress: string}) {
        this.#node = node
        this._start()
    }
    stop() {
        this.#halted = true
    }
    async _start() {
        if (!this.#node.useMulticastUdp()) return
        // to find nodes on the local network
        const multicastSocket = this.#node.dgramCreateSocket({ type: "udp4", reuseAddr: true })
        // const multicastSocket = dgram.createSocket({ type: "udp4", reuseAddr: true })
        const multicastAddress = this.opts.multicastAddress
        const multicastPort = 21010
        multicastSocket.bind(multicastPort)
        multicastSocket.on('listening', function() {
            multicastSocket.addMembership(multicastAddress)
        })
        multicastSocket.on('message', (message, rinfo) => {
            let msg: JSONObject | null = tryParseJsonObject(message.toString())
            if (isMulticastAnnounceMessage(msg)) {
                const msg2: MulticastAnnounceMessage = msg
                /////////////////////////////////////////////////////////////////////////
                action('handleMulticastAnnounceMessage', {fromNodeId: msg.body.fromNodeId}, async () => {
                    if (verifySignature(msg2.body, msg2.signature, nodeIdToPublicKey(msg2.body.fromNodeId), {checkTimestamp: true})) {
                        if (msg2.body.fromNodeId === this.#node.nodeId())
                            return
                        const localUdpAddress: Address | null = msg2.body.udpListenPort ? (
                            {
                                hostName: hostName(rinfo.address),
                                port: msg2.body.udpListenPort
                            }
                        ): null
                        const response = this.#node._handleAnnounceRequest({ fromNodeId: msg2.body.fromNodeId, requestData: msg2.body.requestData, localUdpAddress })
                        // don't do anything with response here
                    }
                    else {
                        throw Error('Problem verifying signature for multicast announce message')
                    }
                }, async (err: Error) => {
                    //
                })
                /////////////////////////////////////////////////////////////////////////
            }
        })
        await sleepMsec(Math.min(1000, durationMsecToNumber(this.opts.intervalMsec)))
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
                    requestData,
                    udpListenPort: this.#node.udpListenPort(),
                    timestamp: nowTimestamp()
                }
                const m: MulticastAnnounceMessage = {
                    body,
                    signature: getSignature(body, this.#node.keyPair())
                }
                const mJson: string = JSON.stringify(m)
                /////////////////////////////////////////////////////////////////////////
                await action('sendMulticastAnnounceMessage', {}, async () => {
                    multicastSocket.send(
                        Buffer.from(mJson),
                        0,
                        mJson.length,
                        multicastPort,
                        multicastAddress
                    )
                }, async () => {
                })
                /////////////////////////////////////////////////////////////////////////
            }
            await sleepMsec(durationMsecToNumber(this.opts.intervalMsec), () => {return !this.#halted})
        }
    }
}
