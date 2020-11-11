import axios from 'axios';
import DataStreamy from '../../common/DataStreamy';
import { Address, byteCount, ByteCount, DurationMsec, durationMsecToNumber, JSONObject, NodeId, UrlPath } from '../../interfaces/core';
import NodeStats from '../../NodeStats';

export const _tests: {[key: string]: () => Promise<void>} = {}

export class HttpPostJsonError extends Error {
    constructor(errorString: string) {
        super(errorString);
    }
}

export const httpPostJson = async (address: Address, path: UrlPath, data: Object, opts: {timeoutMsec: DurationMsec}): Promise<JSONObject> => {
    const url = 'http://' + address.hostName + ':' + address.port + path
    let res
    try {
        res = await axios.post(url, data, {timeout: durationMsecToNumber(opts.timeoutMsec), responseType: 'json'})
    }
    catch(err) {
        throw new HttpPostJsonError(err.message)
    }
    return res.data
}
export const httpGetDownload = async (address: Address, path: UrlPath, stats: NodeStats, opts: {fromNodeId: NodeId}): Promise<DataStreamy> => {
    const url = 'http://' + address.hostName + ':' + address.port + path
    const res = await axios.get(url, {responseType: 'stream'})
    const size: ByteCount = res.headers['Content-Length']
    const ret = new DataStreamy()
    ret.producer().start(size)
    ret.producer().onCancelled(() => {
        // todo: is this the right way to close it?
        res.data.close()
    })
    res.data.on('data', (data: Buffer) => {
        stats.reportBytesReceived('http', opts.fromNodeId, byteCount(data.length))
        ret.producer().data(data)
    })
    res.data.on('error', (err: Error) => {
        ret.producer().error(err)
    })
    res.data.on('end', () => {
        ret.producer().end()
    })

    return ret
}