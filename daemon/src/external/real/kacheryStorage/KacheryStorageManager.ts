import crypto from 'crypto';
import fs from 'fs';
import DataStreamy from '../../../common/DataStreamy';
import { randomAlphaString } from '../../../common/util';
import { byteCount, ByteCount, byteCountToNumber, FileKey, isBuffer, localFilePath, LocalFilePath, Sha1Hash } from '../../../interfaces/core';

export class KacheryStorageManager {
    #storageDir: LocalFilePath
    constructor(storageDir: LocalFilePath) {
        if (!fs.existsSync(storageDir.toString())) {
            throw Error(`Kachery storage directory does not exist: ${storageDir}`)
        }
        this.#storageDir = storageDir
    }
    async findFile(fileKey: FileKey): Promise<{ found: boolean, size: ByteCount }> {
        if (fileKey.sha1) {
            const { path: filePath, size: fileSize } = await this._getLocalFileInfo(fileKey.sha1);
            if ((filePath) && (fileSize !== null)) {
                return { found: true, size: fileSize }
            }
        }
        if (fileKey.chunkOf) {
            const { path: filePath, size: fileSize } = await this._getLocalFileInfo(fileKey.chunkOf.fileKey.sha1)
            if (filePath) {
                const offset = fileKey.chunkOf.startByte
                const size = byteCount(byteCountToNumber(fileKey.chunkOf.endByte) - byteCountToNumber(fileKey.chunkOf.startByte))
                return { found: true, size }
            }
        }
        return { found: false, size: byteCount(0) }
    }
    async storeFile(sha1: Sha1Hash, data: Buffer) {
        const s = sha1;
        const destParentPath = `${this.#storageDir}/sha1/${s[0]}${s[1]}/${s[2]}${s[3]}/${s[4]}${s[5]}`
        const destPath = `${destParentPath}/${s}`
        if (fs.existsSync(destPath)) {
            return
        }
        fs.mkdirSync(destParentPath, {recursive: true});
        const destPathTmp = `${destPath}.${randomAlphaString(5)}.tmp`
        await fs.promises.writeFile(destPathTmp, data)
        if (fs.existsSync(destPath)) {
            fs.unlinkSync(destPathTmp)
            return
        }
        fs.renameSync(destPathTmp, destPath)
    }
    async concatenateChunksAndStoreResult(sha1: Sha1Hash, chunkSha1s: Sha1Hash[]): Promise<void> {
        const s = sha1
        const destParentPath = `${this.#storageDir}/sha1/${s[0]}${s[1]}/${s[2]}${s[3]}/${s[4]}${s[5]}`
        const destPath = `${destParentPath}/${s}`
        if (fs.existsSync(destPath)) {
            // already exists
            return
        }

        // verify we have all the files
        for (let chunkSha1 of chunkSha1s) {
            const f = await this.findFile({sha1: chunkSha1})
            if (!f.found) {
                throw Error(`Cannot concatenate chunk. Missing chunk: ${chunkSha1}`)
            }
        }

        const tmpPath = createTemporaryFilePath({prefix: 'kachery-p2p-concat-'})
        const writeStream = fs.createWriteStream(tmpPath)
        const shasum = crypto.createHash('sha1')
        for (let chunkSha1 of chunkSha1s) {
            const readStream = await this.getFileReadStream({sha1: chunkSha1})
            await new Promise((resolve, reject) => {
                readStream.onData(buf => {
                    shasum.update(buf)
                    writeStream.write(buf)
                })
                readStream.onError(err => {
                    reject(err)
                })
                readStream.onComplete(() => {
                    resolve()
                })
            })
        }
        await new Promise((resolve, reject) => {
            writeStream.end(() => {
                const sha1Computed = shasum.digest('hex') as any as Sha1Hash
                if (sha1Computed !== sha1) {
                    reject(Error('Did not get the expected SHA-1 sum for concatenated file'))
                    return
                }
                resolve()
            })
        })
        if (fs.existsSync(destPath)) {
            // already exists
            fs.unlinkSync(tmpPath)
            return
        }
        fs.mkdirSync(destParentPath, {recursive: true});
        fs.renameSync(tmpPath, destPath)
    }
    async getFileReadStream(fileKey: FileKey): Promise<DataStreamy> {
        if (fileKey.sha1) {
            const { path: filePath, size: fileSize } = await this._getLocalFileInfo(fileKey.sha1);
            if ((filePath) && (fileSize !== null)) {
                return createDataStreamForFile(localFilePath(filePath), byteCount(0), fileSize)
            }
        }
        if (fileKey.chunkOf) {
            const { path: filePath, size: fileSize } = await this._getLocalFileInfo(fileKey.chunkOf.fileKey.sha1)
            if (filePath) {
                const offset = fileKey.chunkOf.startByte
                const size = byteCount(byteCountToNumber(fileKey.chunkOf.endByte) - byteCountToNumber(fileKey.chunkOf.startByte))
                return createDataStreamForFile(localFilePath(filePath), offset, size)
            }
        }
        throw Error('Unable get data read stream for local file.')
    }
    async _getLocalFileInfo(fileSha1: Sha1Hash): Promise<{ path: string | null, size: ByteCount | null }> {
        const s = fileSha1;
        const path = `${this.#storageDir}/sha1/${s[0]}${s[1]}/${s[2]}${s[3]}/${s[4]}${s[5]}/${s}`
        let stat0: fs.Stats
        try {
            stat0 = await fs.promises.stat(path)
        }
        catch (err) {
            return { path: null, size: null }
        }
        return {
            path,
            size: byteCount(stat0.size)
        }
    }
}

const createDataStreamForFile = (path: LocalFilePath, offset: ByteCount, size: ByteCount) => {
    // note.. for some reason if we put {encoding: 'binary'} we get text data chunks
    const readStream = fs.createReadStream(path.toString(), { start: byteCountToNumber(offset), end: byteCountToNumber(offset) + byteCountToNumber(size) - 1 })
    const ret = new DataStreamy()
    ret.producer().start(size)
    readStream.on('data', (chunk: any) => {
        if (!isBuffer(chunk)) {
            throw Error('Unexpected type of data chunk')
        }
        ret.producer().data(chunk)
    })
    readStream.on('end', () => {
        ret.producer().end()
    })
    readStream.on('error', (err: Error) => {
        ret.producer().error(err)
    })
    return ret
}

const _getTemporaryDirectory = () => {
    const ret = process.env['KACHERY_STORAGE_DIR'] + '/tmp'
    mkdirIfNeeded(localFilePath(ret))
    return ret
}

const mkdirIfNeeded = (path: LocalFilePath) => {
    if (!fs.existsSync(path.toString())) {
        try {
            fs.mkdirSync(path.toString())
        }
        catch(err) {
            if (!fs.existsSync(path.toString())) {
                fs.mkdirSync(path.toString())
            }
        }
    }
}

export const createTemporaryFilePath = (args: {prefix: string}) => {
    const dirPath = _getTemporaryDirectory()
    return `${dirPath}/${args.prefix}-${randomAlphaString(10)}`
}