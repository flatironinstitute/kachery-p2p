import axios from 'axios';
import { ClientRequest } from 'http';
import { Socket } from 'net';
import DataStreamy from '../../common/DataStreamy';
import { Address, byteCount, ByteCount, DurationMsec, durationMsecToNumber, JSONObject, NodeId, UrlPath, urlString, UrlString } from '../../interfaces/core';
import NodeStats from '../../NodeStats';

export const _tests: {[key: string]: () => Promise<void>} = {}

export class HttpPostJsonError extends Error {
    constructor(errorString: string) {
        super(errorString);
    }
}

const formUrl = (address: Address, path: UrlPath): UrlString => {
    let url: UrlString
    if (address.url) {
        url = urlString(address.url.toString() + path)
    }
    else if ((address.hostName) && (address.port)) {
        url = urlString('http://' + address.hostName + ':' + address.port + path)
    }
    else {
        throw Error(`Unexpected address in formUrl: ${address}`)
    }
    return url
}

export const httpPostJson = async (address: Address, path: UrlPath, data: Object, opts: {timeoutMsec: DurationMsec}): Promise<JSONObject> => {
    const url = formUrl(address, path)
    let res
    try {
        res = await axios.post(url.toString(), data, {timeout: durationMsecToNumber(opts.timeoutMsec), responseType: 'json'})
    }
    catch(err) {
        throw new HttpPostJsonError(err.message)
    }
    return res.data
}
export const httpGetDownload = async (address: Address, path: UrlPath, stats: NodeStats, opts: {fromNodeId: NodeId}): Promise<DataStreamy> => {
    const url = formUrl(address, path)
    const res = await axios.get(url.toString(), {responseType: 'stream'})
    const stream = res.data
    const socket: Socket = stream.socket
    const req: ClientRequest = stream.req
    const size: ByteCount = res.headers['Content-Length']
    const ret = new DataStreamy()
    let complete = false
    ret.producer().start(size)
    ret.producer().onCancelled(() => {
        if (complete) return
        // todo: is this the right way to close it?
        req.abort()
    })
    stream.on('data', (data: Buffer) => {
        if (complete) return
        stats.reportBytesReceived('http', opts.fromNodeId, byteCount(data.length))
        ret.producer().data(data)
    })
    stream.on('error', (err: Error) => {
        if (complete) return
        complete = true
        ret.producer().error(err)
    })
    stream.on('end', () => {
        if (complete) return
        complete = true
        ret.producer().end()
    })
    socket.on('close', () => {
        if (complete) return
        complete = true
        ret.producer().error(Error('Socket closed.'))
    })

    return ret
}