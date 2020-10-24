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
    async concatenateChunks(sha1: Sha1Hash, chunkSha1s: Sha1Hash[]): Promise<void> {
        throw Error('not-implemented') // todo ********************
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