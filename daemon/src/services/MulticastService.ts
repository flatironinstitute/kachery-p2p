import { action } from "../common/action"
import { getSignature, verifySignature } from "../common/crypto_util"
import { sleepMsec } from "../common/util"
import { DgramSocket } from "../external/ExternalInterface"
import { Address, byteCount, DurationMsec, hostName, isMulticastAnnounceMessage, JSONObject, minDuration, MulticastAnnounceMessage, MulticastAnnounceMessageBody, nodeIdToPublicKey, nowTimestamp, portToNumber, scaledDurationMsec, tryParseJsonObject } from "../interfaces/core"
import { AnnounceRequestData } from "../interfaces/NodeToNodeRequest"
import KacheryP2PNode from "../KacheryP2PNode"
import { protocolVersion } from "../protocolVersion"

export default class MulticastService {
    #node: KacheryP2PNode
    #halted = false
    #multicastSocket: DgramSocket | null = null
    constructor(node: KacheryP2PNode, private opts: {intervalMsec: DurationMsec, multicastAddress: Address}) {
        this.#node = node
        this._start()
    }
    stop() {
        if (this.#multicastSocket) {
            this.#multicastSocket.close()
            this.#multicastSocket = null
        }
        this.#halted = true
    }
    async _start() {
        if (!this.#node.useMulticastUdp()) return
        // to find nodes on the local network
        this.#multicastSocket = this.#node.externalInterface().dgramCreateSocket({ type: "udp4", reuseAddr: true, nodeId: this.#node.nodeId(), firewalled: true })
        const multicastAddress = this.opts.multicastAddress
        const multicastPort = multicastAddress.port
        if (!multicastAddress.hostName) throw Error('Unexpected multicast address')
        if (!multicastAddress.port) throw Error('Unexpected multicast address port')
        this.#multicastSocket.bind(portToNumber(multicastAddress.port))
        this.#multicastSocket.on('listening', () => {
            if (!multicastAddress.hostName) throw Error('Unexpected multicast address')
            if (this.#multicastSocket) {
                this.#multicastSocket.addMembership(multicastAddress.hostName.toString())
            }
        })
        this.#multicastSocket.on('message', (message, rinfo) => {
            let msg: JSONObject | null = tryParseJsonObject(message.toString())
            if (isMulticastAnnounceMessage(msg)) {
                this.#node.stats().reportBytesReceived('multicastUdp', msg.body.fromNodeId, byteCount(message.length))
                const msg2: MulticastAnnounceMessage = msg
                /////////////////////////////////////////////////////////////////////////
                action('handleMulticastAnnounceMessage', {fromNodeId: msg.body.fromNodeId}, async () => {
                    if (verifySignature(msg2.body, msg2.signature, nodeIdToPublicKey(msg2.body.fromNodeId), {checkTimestamp: true})) {
                        if (msg2.body.fromNodeId === this.#node.nodeId())
                            return
                        const localUdpAddress: Address | null = msg2.body.udpSocketPort ? (
                            {
                                hostName: hostName(rinfo.address),
                                port: msg2.body.udpSocketPort
                            }
                        ): null
                        const response = this.#node.remoteNodeManager().handleAnnounceRequest({fromNodeId: msg2.body.fromNodeId, requestData: msg2.body.requestData, localUdpAddress})
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
        await sleepMsec(minDuration(scaledDurationMsec(1000), this.opts.intervalMsec))
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
                    udpSocketPort: this.#node.udpSocketPort(),
                    timestamp: nowTimestamp()
                }
                const m: MulticastAnnounceMessage = {
                    body,
                    signature: getSignature(body, this.#node.keyPair())
                }
                const mJson: string = JSON.stringify(m)
                /////////////////////////////////////////////////////////////////////////
                await action('sendMulticastAnnounceMessage', {}, async () => {
                    if (this.#multicastSocket) {
                        this.#node.stats().reportBytesSent('multicastUdp', null, byteCount(mJson.length))
                        if (!multicastAddress.hostName) throw Error('Unexpected multicast address')
                        if (!multicastAddress.port) throw Error('Unexpected multicast address port')
                        this.#multicastSocket.send(
                            Buffer.from(mJson),
                            0,
                            mJson.length,
                            portToNumber(multicastAddress.port),
                            multicastAddress.hostName.toString()
                        )
                    }
                    else {
                        throw Error('No multicast socket')
                    }
                }, async (err: Error) => {
                    console.warn(`Problem sending multicast announce message (${err.message})`)
                })
                /////////////////////////////////////////////////////////////////////////
            }
            await sleepMsec(this.opts.intervalMsec, () => {return !this.#halted})
        }
    }
}
