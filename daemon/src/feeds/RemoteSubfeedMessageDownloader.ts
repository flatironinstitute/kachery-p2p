import { TIMEOUTS } from "../common/constants";
import { isArrayOf, isSignedSubfeedMessage, messageCount, MessageCount, messageCountToNumber, NodeId, SignedSubfeedMessage, subfeedPosition, SubfeedPosition } from "../interfaces/core";
import { DownloadSubfeedMessagesRequestData, isDownloadSubfeedMessagesResponseData } from "../interfaces/NodeToNodeRequest";
import KacheryP2PNode from "../KacheryP2PNode";
import Subfeed from "./Subfeed";

class RemoteSubfeedMessageDownloader {
    #remoteNodeId: NodeId | null = null
    #numRemoteMessages: MessageCount | null = null
    #activeDownload = false
    constructor(private node: KacheryP2PNode, private subfeed: Subfeed) {
    }
    reportNumRemoteMessages(remoteNodeId: NodeId, numRemoteMessages: MessageCount) {
        this.#remoteNodeId = remoteNodeId
        this.#numRemoteMessages = numRemoteMessages
        if (this.subfeed.getNumLocalMessages() < this.#numRemoteMessages) {
            if (!this.#activeDownload) this._startDownload()
        }
    }
    async _startDownload() {
        if (this.#activeDownload) return
        this.#activeDownload = true
        while (true) {
            const numLocalMessages = this.subfeed.getNumLocalMessages()
            const numRemoteMessages = this.#numRemoteMessages
            if (numRemoteMessages === null) break
            const remoteNodeId = this.#remoteNodeId
            if (remoteNodeId === null) break
            const numMessagesToDownload = messageCountToNumber(numRemoteMessages) - messageCountToNumber(numLocalMessages)
            if (numMessagesToDownload <= 0) break
            let signedMessages: SignedSubfeedMessage[]
            try {
                signedMessages = await this._doDownloadRemoteMessages(remoteNodeId, subfeedPosition(messageCountToNumber(numLocalMessages)), messageCount(numMessagesToDownload))
            }
            catch(err) {
                console.warn('Error downloading remote subfeed messages', err)
                break
            }
            if (signedMessages.length !== numMessagesToDownload) {
                console.warn('Unexpected problem downloading remote subfeed messages. Got unexpected number of messages.')
                break
            }
            // maybe somehow the number of local messages has changed (shouldn't happen though)
            const signedMessagesToAppend = signedMessages.slice(messageCountToNumber(this.subfeed.getNumLocalMessages()) - messageCountToNumber(numLocalMessages))
            await this.subfeed.appendSignedMessages(signedMessagesToAppend)
        }
        this.#activeDownload = false
    }
    async _doDownloadRemoteMessages(remoteNodeId: NodeId, position: SubfeedPosition, numMessages: MessageCount): Promise<SignedSubfeedMessage[]> {
        const n = this.node.remoteNodeManager().getRemoteNode(remoteNodeId)
        /* istanbul ignore next */
        if (!n) {
            throw Error('Unexpected. Remote node not found.')
        }
        const requestData: DownloadSubfeedMessagesRequestData = {
            requestType: 'downloadSubfeedMessages',
            feedId: this.subfeed.getFeedId(),
            subfeedHash: this.subfeed.getSubfeedHash(),
            position,
            numMessages
        }
        const responseData = await n.sendRequest(requestData, {timeoutMsec: TIMEOUTS.defaultRequest, method: 'default'})
        if (!isDownloadSubfeedMessagesResponseData(responseData)) {
            throw Error('Unexpected response data for downloadSubfeedMessages')
        }
        if (!responseData.success) {
            throw Error(`Unable to download remote messages: ${responseData.errorMessage}`)
        }
        if (!responseData.streamId) {
            throw Error('Unexpected: no stream ID')
        }
        const o = await n.downloadFileData(responseData.streamId, {method: 'default'})
        return new Promise((resolve, reject) => {
            let completed = false
            const _data: Buffer[] = []
            o.dataStream.onError(err => {
                if (completed) return
                completed = true
                reject(err)
            })
            const _err = (err: Error) => {
                if (completed) return
                completed = true
                reject()
            }
            o.dataStream.onFinished(() => {
                if (completed) return
                let json
                try {
                    const data = Buffer.concat(_data)
                    json = data.toString('utf-8')
                }
                catch(err) {
                    _err(new Error('Problem assembling downloaded signed messages'))
                    return
                }
                let signedMessages
                try {
                    signedMessages = JSON.parse(json)
                }
                catch(err) {
                    _err(new Error('Problem parsing downloaded signed messages'))
                    return
                }
                if (!isArrayOf(isSignedSubfeedMessage)(signedMessages)) {
                    _err(new Error('Invalid array of downloaded signed messages'))
                    return
                }
                resolve(signedMessages)
            })
            o.dataStream.onData((buf: Buffer) => {
                if (completed) return
                _data.push(buf)
            })
        })
    }
}

export default RemoteSubfeedMessageDownloader