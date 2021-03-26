import { DataStreamyProgress } from "../common/DataStreamy";
import GarbageMap from "../common/GarbageMap";
import { sleepMsec } from "../common/util";
import { byteCount, DurationMsec, FileKey, scaledDurationMsec, Sha1Hash, _validateObject } from "../interfaces/core";
import KacheryP2PNode from "../KacheryP2PNode";
import { loadFile, loadFileAsync } from "../loadFile";
import { MirrorSourceConfig } from "./ConfigUpdateService";

const createFileKey = (sha1: Sha1Hash, query: {[key: string]: string}) => {
    const fileKey: FileKey = {sha1}
    if ('manifest' in query) {
        fileKey['manifestSha1'] = query.manifest as any as Sha1Hash
    }
    if ('chunkOf' in query) {
        const v = query['chunkOf'].split('~')
        if (v.length !== 3) {
            throw Error(`Unexpected chunkOf in URI query.`)
        }
        fileKey['chunkOf'] = {
            fileKey: {sha1: v[0] as any as Sha1Hash},
            startByte: byteCount(parseInt(v[1])),
            endByte: byteCount(parseInt(v[2]))
        }
    }
    return fileKey
}

function parseQueryString(queryString: string) {
    var query: {[key: string]: string} = {};
    var pairs = (queryString[0] === '?' ? queryString.substr(1) : queryString).split('&');
    for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i].split('=');
        query[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
    }
    return query;
}

const parseKacheryUri = (uri: string) => {
    const listA = uri.split('?')
    const query = (listA.length > 1) ? parseQueryString(listA[1]) : {}
    const list0 = listA[0].split('/')
    const protocol = list0[0].replace(':', '')
    let hash0 = list0[2]
    if (hash0.includes('.')) {
        hash0 = hash0.split('.')[0]
    }
    const additional_path = list0.slice(3).join('/')
    let algorithm = null
    for (let alg of ['sha1', 'md5', 'key']) {
        if (protocol.startsWith(alg)) algorithm = alg
    }
    if (!algorithm) {
        throw Error(`Unexpected protocol in kachery uri: ${protocol}`)
    }
    return {
        protocol, algorithm, hash0, additional_path, query
    }
}

const fileKeyFromUri = (uri: string) => {
    const {protocol, algorithm, hash0, additional_path, query} = parseKacheryUri(uri)
    if (algorithm !== 'sha1') {
        throw Error(`Unsupported algorith: ${algorithm}`)
    }
    return createFileKey(hash0 as any as Sha1Hash, query)
}

class MirrorManager {
    #urisToMirror: string[] = []
    #halted = false
    #currentFileIndex = 0
    #mirroredFileUris = new GarbageMap<string, boolean>(scaledDurationMsec(1000 * 60 * 60))
    constructor(private node: KacheryP2PNode) {
        this._start()
    }
    setUrisToMirror(x: string[]) {
        this.#urisToMirror = x
    }
    halt() {
    }
    async _mirrorFile(uri: string) {
        let fileKey: FileKey
        fileKey = fileKeyFromUri(uri)
        const hasLocalFile = await this.node.kacheryStorageManager().hasLocalFile(fileKey)
        if (hasLocalFile) return
        
        console.info(`Mirroring file: ${uri}`)

        return new Promise<void>((resolve, reject) => {
            loadFile(this.node, fileKey, {fromNode: null, label: `Mirror ${uri}`}).then((x) => {
                x.onFinished(() => {
                    this.#mirroredFileUris.set(uri, true)
                    resolve()
                })
                x.onError((err: Error) => {
                    console.info(`Error mirroring file (${err.message}): ${uri}`)
                    resolve()
                })
                x.onProgress((p: DataStreamyProgress) => {
    
                })
            }).catch((err: Error) => {
                console.info(`Problem mirroring file (${err.message}): ${uri}`)
                resolve()
            })
        })
        
    }
    async _start() {
        while (true) {
            if (this.#halted) return
            
            if (this.#currentFileIndex < this.#urisToMirror.length) {
                const uri = this.#urisToMirror[this.#currentFileIndex]
                if (!this.#mirroredFileUris.get(uri)) {
                    try {
                        await this._mirrorFile(uri)
                    }
                    catch(err) {
                        console.warn(`Problem mirroring file (${err.message}): ${uri}`)
                    }
                }
                this.#currentFileIndex ++
            }
            else {
                // wait a bit before starting again
                await sleepMsec(scaledDurationMsec(1000 * 120), () => {return !this.#halted})
                this.#currentFileIndex = 0
            }

            // duty cycle
            await sleepMsec(scaledDurationMsec(30), () => {return !this.#halted})
        }
    }
}

class MirrorSourceManager {
    #mirrorManager: MirrorManager
    constructor(private node: KacheryP2PNode) {
        this.#mirrorManager = new MirrorManager(node)
    }
    async update() {
        const urisToMirror: string[] = []
        const urisToMirrorSet = new Set<string>()
        for (let ms of this.node.mirrorSources()) {
            let uris: string[]
            try {
                uris = await this._getUrisToMirrorFromMirrorSource(ms)
            }
            catch(err) {
                console.warn(`Unable to get uris to mirror (${err.message}): ${ms.uri}`)
                uris = []
            }
            for (let uri of uris) {
                if (!urisToMirrorSet.has(uri)) {
                    urisToMirror.push(uri)
                    urisToMirrorSet.add(uri)
                }
            }
        }
        this.#mirrorManager.setUrisToMirror(urisToMirror)
    }
    async _getUrisToMirrorFromMirrorSource(x: MirrorSourceConfig): Promise<string[]> {
        const fileKey = fileKeyFromUri(x.uri)
        const {found, size} = await loadFileAsync(this.node, fileKey, {fromNode: null, label: `Mirror source: ${x.uri}`})
        if (!found) {
            throw Error('Unable to find file.')
        }
        const mirrorSourceDataStream = await this.node.kacheryStorageManager().getFileReadStream(fileKey)
        const mirrorSourceText = (await mirrorSourceDataStream.allData()).toString()
        const mirrorSourceContent = JSON.parse(mirrorSourceText)
        return this._getUrisToMirrorFromMirrorSourceContent(mirrorSourceContent)
    }
    _getUrisToMirrorFromMirrorSourceContent(content: any): string[] {
        if (!content) return []
        if (typeof(content) == 'string') {
            if (content.startsWith('sha1://')) return [content]
            else return []
        }
        else if (typeof(content) == 'object') {
            const ret: string[] = []
            if (Array.isArray(content)) {
                for (let a of content) {
                    const b = this._getUrisToMirrorFromMirrorSourceContent(a)
                    for (let uri of b) ret.push(uri)
                }
            }
            else {
                for (let k in content) {
                    const b = this._getUrisToMirrorFromMirrorSourceContent(content[k])
                    for (let uri of b) ret.push(uri)
                }
            }
            return ret
        }
        else return []
    }
    halt() {
        this.#mirrorManager.halt()
    }
}

export default class MirrorService {
    #node: KacheryP2PNode
    #halted = false
    #mirrorSourceManager: MirrorSourceManager
    constructor(node: KacheryP2PNode, private opts: {}) {
        this.#node = node
        this.#mirrorSourceManager = new MirrorSourceManager(node)

        this._start()
    }
    stop() {
        this.#mirrorSourceManager.halt()
        this.#halted = true
    }
    async _start() {
        const intervalMsec = scaledDurationMsec(1000 * 60 * 3)
        // wait a bit before starting
        await sleepMsec(scaledDurationMsec(1000 * 5), () => {return !this.#halted})
        while (true) {
            if (this.#halted) return
            await this.#mirrorSourceManager.update()

            await sleepMsec(intervalMsec, () => {return !this.#halted})
        }
    }
}