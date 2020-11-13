import GarbageMap from "../common/GarbageMap";
import { ChannelName, DurationMsec, durationMsecToNumber, elapsedSince, nowTimestamp, RequestId, scaledDurationMsec, Timestamp } from "../interfaces/core";
import KacheryP2PNode from "../KacheryP2PNode";
import RemoteNode, { SendRequestMethod } from "../RemoteNode";

export default class SendMessageMethodOptimizer {
    #methodHealths = {
        'udp': new MethodHealth(),
        'http': new MethodHealth(),
        'http-proxy': new MethodHealth(),
        'websocket': new MethodHealth()
    }
    constructor(private node: KacheryP2PNode, private remoteNode: RemoteNode) {
    }
    reportSendRequestStart(requestId: RequestId, method: SendRequestMethod, timeoutMsec: DurationMsec) {
        if ((method === 'udp') || (method === 'http') || (method === 'http-proxy') || (method === 'websocket')) {
            this.#methodHealths[method].reportSendRequestStart(requestId, timeoutMsec)
        }
        else {
            /* istanbul ignore next */
            throw Error(`Unexpected method ${method} in reportSendRequestStart`)
        }
    }
    reportSendRequestEnd(requestId: RequestId, method: SendRequestMethod) {
        if ((method === 'udp') || (method === 'http') || (method === 'http-proxy') || (method === 'websocket')) {
            this.#methodHealths[method].reportSendRequestEnd(requestId)
        }
        else {
            /* istanbul ignore next */
            throw Error('Unexpected method ${method} in reportSendRequestEnd')
        }
    }
    determineSendRequestMethod(method: SendRequestMethod, channelName: ChannelName): SendRequestMethod | null {
        const websocketAvailable = (this.node.getProxyConnectionToClient(this.remoteNode.remoteNodeId()) || this.node.getProxyConnectionToServer(this.remoteNode.remoteNodeId())) ? true : false
        const availableMethods = {
            'http': this.remoteNode.getRemoteNodeHttpAddress() ? true : false,
            'http-proxy': this.remoteNode.getRemoteNodeMessageProxyNode(channelName) ? true : false,
            'udp': ((this.node.publicUdpSocketServer()) && (this.remoteNode.getUdpAddressForRemoteNode())),
            'websocket': websocketAvailable
        }
        if (method === 'udp-fallback') {
            if (availableMethods['http']) {
                return 'http'
            }
            else if (availableMethods['websocket']) {
                return 'websocket'
            }
            else if (availableMethods['http-proxy']) {
                return 'http-proxy'
            }
            else {
                return null
            }
        }
        else if (method === 'default') {
            return this.determineSendRequestMethod('prefer-http', channelName)
        }
        else if (method === 'prefer-http') {
            if (availableMethods['http']) {
                return 'http'
            }
            else if (availableMethods['websocket']) {
                return 'websocket'
            }
            else {
                if ((availableMethods['udp']) && (availableMethods['http-proxy'])) {
                    // use 'udp' or 'http-proxy', whichever has better health
                    if (this.#methodHealths['udp'].health() >= this.#methodHealths['http-proxy'].health()) {
                        return 'udp'
                    }
                    else {
                        return 'http-proxy'
                    }
                }
                else if (availableMethods['udp']) {
                    return 'udp'
                }
                else if (availableMethods['http-proxy']) {
                    return 'http-proxy'
                }
                else {
                    return null
                }
            }
        }
        else if (method === 'prefer-udp') {
            if (availableMethods['udp']) {
                return 'udp'
            }
            else {
                return this.determineSendRequestMethod('prefer-http', channelName)
            }
        }
        else if ((method === 'http') || (method === 'websocket') || (method === 'udp') || (method === 'http-proxy')) {
            if (availableMethods[method])
                return method
            else
                return null
        }
        else {
            return null
        }
    }
}

interface RequestRecord {
    timestamp: Timestamp,
    timeoutMsec: DurationMsec
}

class MethodHealth {
    #health = 0
    #requestRecords = new GarbageMap<RequestId, RequestRecord>(scaledDurationMsec(2 * 60 * 1000))
    health() {
        return 0
    }
    reportSendRequestStart(requestId: RequestId, timeoutMsec: DurationMsec) {
        this.#requestRecords.set(requestId, {
            timestamp: nowTimestamp(),
            timeoutMsec
        })
        setTimeout(() => {
            if (this.#requestRecords.has(requestId)) {
                // we still haven't gotten the response - give it a score of -1
                this._reportScore(requestId, -1)
            }
        }, durationMsecToNumber(timeoutMsec) * 2)
    }
    reportSendRequestEnd(requestId: RequestId) {
        const r = this.#requestRecords.get(requestId)
        if (!r) return
        const elapsed = elapsedSince(r.timestamp)
        if (elapsed <= durationMsecToNumber(r.timeoutMsec) * 0.5) {
            // it came back fast, give it a score of 1
            this._reportScore(requestId, 1)
        }
        else if (elapsed <= durationMsecToNumber(r.timeoutMsec) * 1) {
            // it came back reasonable, give it a score of 0.5
            this._reportScore(requestId, 0.5)
        }
        else if (elapsed <= durationMsecToNumber(r.timeoutMsec) * 1.5) {
            // at least it came back (sort of unexpected)
            this._reportScore(requestId, 0)
        }
        else {
            // it took too long (sort of unexpected)
            this._reportScore(requestId, -1)
        }
    }
    _reportScore(requestId: RequestId, score: number) {
        const r = this.#requestRecords.get(requestId)
        if (!r) return
        const alpha = 0.2
        this.#health = this.#health * (1 - alpha) + score * alpha
        this.#requestRecords.delete(requestId)
    }
}