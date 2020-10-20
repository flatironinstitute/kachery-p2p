import axios from 'axios';
import DataStreamy from '../../common/DataStreamy';
import { Address, ByteCount, DurationMsec, durationMsecToNumber, JSONObject, UrlPath } from '../../interfaces/core';

export const _tests: {[key: string]: () => Promise<void>} = {}

export const httpPostJson = async (address: Address, path: UrlPath, data: Object, opts: {timeoutMsec: DurationMsec}): Promise<JSONObject> => {
    const res = await axios.post('http://' + address.hostName + ':' + address.port + path, data, {timeout: durationMsecToNumber(opts.timeoutMsec), responseType: 'json'})
    return res.data
}
export const httpGetDownload = async (address: Address, path: UrlPath): Promise<DataStreamy> => {
    const res = await axios.get('http://' + address.hostName + ':' + address.port + path, {responseType: 'stream'})
    const size: ByteCount = res.headers['Content-Length']
    const ret = new DataStreamy()
    ret._start(size)
    ret._onCancel(() => {
        // todo
    })
    res.data.on('data', (data: Buffer) => {
        ret._data(data)
    })
    res.data.on('error', (err: Error) => {
        ret._error(err)
    })
    res.data.on('end', () => {
        ret._end()
    })

    return ret
}

// export const httpPostJsonStreamResponse = (address: Address, path: UrlPath, data: Object): {
//     onData: (callback: (data: Buffer) => void) => void,
//     onFinished: (callback: () => void) => void,
//     onError: (callback: (err: Error) => void) => void,
//     cancel: () => void
// } => {
//     const _onDataCallbacks: ((data: Buffer) => void)[] = []
//     const _onFinishedCallbacks: (() => void)[] = []
//     const _onErrorCallbacks: ((err: Error) => void)[] = []
//     let stream: Readable | null = null
//     let cancelled = false
//     let completed = false
//     const _cancel = () => {
//         if (cancelled) return
//         cancelled = true
//         if (stream) stream.destroy()
//     }

//     const _handleError = (err: Error) => {
//         if (completed) return
//         completed = true
//         _onErrorCallbacks.forEach(cb => {cb(err)})
//     }
//     const _handleFinished = () => {
//         if (completed) return
//         completed = true
//         _onFinishedCallbacks.forEach(cb => {cb()})
//     }
//     const _handleData = (data: Buffer) => {
//         if (completed) return
//         _onDataCallbacks.forEach(cb => {cb(data)})
//     }

//     axios.post('http://' + address.hostName + ':' + address.port + path, data, {responseType: "stream"}).then(response => {
//         stream = response.data
//         if (!stream) {
//             _handleError(Error('Unexpected... stream is null'))
//             return
//         }
//         stream.on('data', (data: Buffer) => {
//             _handleData(data)
//         })
//         stream.on('end', () => {
//             _handleFinished()
//         })
//         stream.on('error', (err: Error) => {
//             _handleError(err)
//         })
//         if (cancelled) stream.destroy()
//     }).catch(err => {
//         setTimeout(() => {
//             _handleError(err)
//         }, 1)
//     })

//     return {
//         onData: (callback: (data: Buffer) => void) => {_onDataCallbacks.push(callback)},
//         onFinished: (callback: () => void) => {_onFinishedCallbacks.push(callback)},
//         onError: (callback: (err: Error) => void) => {_onErrorCallbacks.push(callback)},
//         cancel: _cancel
//     }
// }