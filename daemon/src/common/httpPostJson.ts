import axios from 'axios';
import http from 'http';
import { Readable } from 'stream';
import { Address, HostName, JSONObject, Port } from '../interfaces/core';
import { StreamFileDataOutput } from '../KacheryP2PNode';
import { ByteCount, durationMsec, DurationMsec, durationMsecToNumber } from '../udp/UdpCongestionManager';

export const _tests: {[key: string]: () => Promise<void>} = {}

export interface UrlPath extends String {
    __urlPath__: never
}
export const urlPath = (x: string) => {
    return x as any as UrlPath
}

export const httpPostJson = async (address: Address, path: UrlPath, data: Object, opts: {timeoutMsec: DurationMsec}): Promise<JSONObject> => {
    const res = await axios.post('http://' + address.hostName + ':' + address.port + path, data, {timeout: durationMsecToNumber(opts.timeoutMsec), responseType: 'json'})
    return res.data
}
export const httpGetDownload = async (address: Address, path: UrlPath): Promise<StreamFileDataOutput> => {
    const _onStartedCallbacks: ((size: ByteCount) => void)[] = []
    const _onDataCallbacks: ((data: Buffer) => void)[] = []
    const _onFinishedCallbacks: (() => void)[] = []
    const _onErrorCallbacks: ((err: Error) => void)[] = []
    let started = false
    const res = await axios.get('http://' + address.hostName + ':' + address.port + path, {responseType: 'stream'})
    const size: ByteCount = res.headers['Content-Length']
    res.data.on('data', (data: Buffer) => {
        if (!started) {
            started = true
            _onStartedCallbacks.forEach(cb => {
                cb(size)
            })
        }
        _onDataCallbacks.forEach(cb => {
            cb(data)
        })
    })
    res.data.on('error', (err: Error) => {
        _onErrorCallbacks.forEach(cb => {
            cb(err)
        })
    })
    res.data.on('end', () => {
        _onFinishedCallbacks.forEach(cb => {
            cb()
        })
    })
    return {
        onStarted: (callback: (size: ByteCount) => void) => {
            _onStartedCallbacks.push(callback)
        },
        onData: (callback: (data: Buffer) => void) => {
            _onDataCallbacks.push(callback)
        },
        onFinished: (callback: () => void) => {
            _onFinishedCallbacks.push(callback)
        },
        onError: (callback: (err: Error) => void) => {
            _onErrorCallbacks.push(callback)
        },
        cancel: () => {
            // todo
        }
    }
}
_tests.httpPostJson = async () => {
    return new Promise((resolve, reject) => {
        let completed = false
        const _error = (err: Error) => {
            if (completed) return
            completed = true
            server.close()
            reject(err)
        }
        const _finished = () => {
            if (completed) return
            completed = true
            server.close()
            resolve()
        }
        const PORT = 9438
        const server = http.createServer((req, res) => {
            let chunks: Buffer[] = []
            req.on('data', chunk => {
                chunks.push(chunk)
            })
            req.on('end', () => {
                const msg = JSON.parse(Buffer.concat(chunks).toString())
                const response = {
                    echo: msg
                }
                res.setHeader('Content-Type', 'application/json');
                res.write(JSON.stringify(response));
                res.end()
            })
        }).listen(PORT);
        server.on('listening', async () => {
            const x = await httpPostJson({
                hostName: 'localhost' as any as HostName,
                port: PORT as any as Port
            }, urlPath('/test'), {test: 'data'}, {timeoutMsec: durationMsec(4000)})
            if (JSON.stringify(x) !== JSON.stringify({echo: {test: 'data'}})) {
                _error(Error('Problem with response'))
                return
            }
            _finished()
        })
    })
}

export const httpPostJsonStreamResponse = (address: Address, path: UrlPath, data: Object): {
    onData: (callback: (data: Buffer) => void) => void,
    onFinished: (callback: () => void) => void,
    onError: (callback: (err: Error) => void) => void,
    cancel: () => void
} => {
    const _onDataCallbacks: ((data: Buffer) => void)[] = []
    const _onFinishedCallbacks: (() => void)[] = []
    const _onErrorCallbacks: ((err: Error) => void)[] = []
    let stream: Readable | null = null
    let cancelled = false
    let completed = false
    const _cancel = () => {
        if (cancelled) return
        cancelled = true
        if (stream) stream.destroy()
    }

    const _handleError = (err: Error) => {
        if (completed) return
        completed = true
        _onErrorCallbacks.forEach(cb => {cb(err)})
    }
    const _handleFinished = () => {
        if (completed) return
        completed = true
        _onFinishedCallbacks.forEach(cb => {cb()})
    }
    const _handleData = (data: Buffer) => {
        if (completed) return
        _onDataCallbacks.forEach(cb => {cb(data)})
    }

    axios.post('http://' + address.hostName + ':' + address.port + path, data, {responseType: "stream"}).then(response => {
        stream = response.data
        if (!stream) {
            _handleError(Error('Unexpected... stream is null'))
            return
        }
        stream.on('data', (data: Buffer) => {
            _handleData(data)
        })
        stream.on('end', () => {
            _handleFinished()
        })
        stream.on('error', (err: Error) => {
            _handleError(err)
        })
        if (cancelled) stream.destroy()
    }).catch(err => {
        setTimeout(() => {
            _handleError(err)
        }, 1)
    })

    return {
        onData: (callback: (data: Buffer) => void) => {_onDataCallbacks.push(callback)},
        onFinished: (callback: () => void) => {_onFinishedCallbacks.push(callback)},
        onError: (callback: (err: Error) => void) => {_onErrorCallbacks.push(callback)},
        cancel: _cancel
    }
}

_tests.httpPostJsonStreamResponse = async () => {
    return new Promise((resolve, reject) => {
        let completed = false
        const _error = (err: Error) => {
            if (completed) return
            completed = true
            server.close()
            console.warn(err)
            reject(err)
        }
        const _finished = () => {
            if (completed) return
            completed = true
            server.close()
            resolve()
        }
        const PORT = 9438
        const server = http.createServer((req, res) => {
            let chunks: Buffer[] = []
            req.on('data', chunk => {
                chunks.push(chunk)
            })
            req.on('end', () => {
                const msg = JSON.parse(Buffer.concat(chunks).toString())
                const response = {
                    echo: msg
                }
                res.setHeader('Content-Type', 'application/json');
                res.write(JSON.stringify(response));
                setTimeout(() => {
                    res.write(JSON.stringify(response));
                    res.end()
                }, 100)
            })
        }).listen(PORT);
        server.on('listening', () => {
            const x = httpPostJsonStreamResponse({
                hostName: 'localhost' as any as HostName,
                port: PORT as any as Port
            }, urlPath('/test'), {test: 'data'})
            let count = 0
            x.onData(data => {
                const msg = JSON.parse(data.toString())
                if (JSON.stringify(msg) !== JSON.stringify({echo: {test: 'data'}})) {
                    _error(Error('Problem with response'))
                    return
                }
                count++
            })
            x.onFinished(() => {
                if (count !== 2) {
                    _error(Error('Unexpected count'))
                    return
                }
                _finished()
            })
            x.onError(err => {
                _error(err)
            })
        })
    })
}