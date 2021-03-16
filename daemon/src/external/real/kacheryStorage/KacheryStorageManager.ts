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
    async findFile(fileKey: FileKey): Promise<{ found: boolean, size: ByteCount, localFilePath: LocalFilePath | null }> {
        if (fileKey.sha1) {
            const { path: filePath, size: fileSize } = await this._getLocalFileInfo(fileKey.sha1);
            if ((filePath) && (fileSize !== null)) {
                return { found: true, size: fileSize, localFilePath: filePath }
            }
        }
        if (fileKey.chunkOf) {
            const { path: filePath, size: fileSize } = await this._getLocalFileInfo(fileKey.chunkOf.fileKey.sha1)
            if (filePath) {
                const offset = fileKey.chunkOf.startByte
                const size = byteCount(byteCountToNumber(fileKey.chunkOf.endByte) - byteCountToNumber(fileKey.chunkOf.startByte))
                return { found: true, size, localFilePath: null } // in this case it's not the entire file, so we are not going to return the local file path
            }
        }
        return { found: false, size: byteCount(0), localFilePath: null }
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
            /* istanbul ignore next */
            {
                fs.unlinkSync(destPathTmp)
                return
            }
        }
        fs.renameSync(destPathTmp, destPath)
    }
    async storeLocalFile(localFilePath: LocalFilePath): Promise<Sha1Hash> {
        let stat0: fs.Stats
        try {
            stat0 = await fs.promises.stat(localFilePath.toString())
        }
        catch (err) {
            throw Error(`Unable to stat file: ${localFilePath}`)
        }
        const fileSize = byteCount(stat0.size)
        const ds = createDataStreamForFile(localFilePath, byteCount(0), fileSize)
        const tmpDestPath = `${this.#storageDir}/store.file.${randomAlphaString(10)}.tmp`
        const writeStream = fs.createWriteStream(tmpDestPath)
        const shasum = crypto.createHash('sha1')
        let complete = false
        return new Promise((resolve, reject) => {
            const _cleanup = () => {
                try {
                    fs.unlinkSync(tmpDestPath)
                }
                catch(e) {
                }
            }
            ds.onData(buf => {
                if (complete) return
                shasum.update(buf)
                writeStream.write(buf)
            })
            ds.onError(err => {
                if (complete) return
                complete = true
                _cleanup()
                reject(err)
            })
            ds.onFinished(() => {
                if (complete) return
                complete = true
                try {
                    const sha1Computed = shasum.digest('hex') as any as Sha1Hash
                    const s = sha1Computed
                    const destParentPath = `${this.#storageDir}/sha1/${s[0]}${s[1]}/${s[2]}${s[3]}/${s[4]}${s[5]}`
                    const destPath = `${destParentPath}/${s}`
                    fs.mkdirSync(destParentPath, {recursive: true});
                    fs.renameSync(tmpDestPath, destPath)
                    resolve(sha1Computed)
                }
                catch(err2) {
                    _cleanup()
                    reject(err2)
                }
            })
        })
    }
    async concatenateChunksAndStoreResult(sha1: Sha1Hash, chunkSha1s: Sha1Hash[]): Promise<void> {
        const s = sha1
        const destParentPath = `${this.#storageDir}/sha1/${s[0]}${s[1]}/${s[2]}${s[3]}/${s[4]}${s[5]}`
        const destPath = `${destParentPath}/${s}`
        if (fs.existsSync(destPath)) {
            // already exists
            /* istanbul ignore next */
            return
        }

        // verify we have all the files
        for (let chunkSha1 of chunkSha1s) {
            const f = await this.findFile({sha1: chunkSha1})
            if (!f.found) {
                /* istanbul ignore next */
                throw Error(`Cannot concatenate chunk. Missing chunk: ${chunkSha1}`)
            }
        }

        const tmpPath = createTemporaryFilePath({storageDir: this.#storageDir, prefix: 'kachery-p2p-concat-'})
        const writeStream = fs.createWriteStream(tmpPath)
        const shasum = crypto.createHash('sha1')
        for (let chunkSha1 of chunkSha1s) {
            const readStream = await this.getFileReadStream({sha1: chunkSha1})
            await new Promise<void>((resolve, reject) => {
                readStream.onData(buf => {
                    shasum.update(buf)
                    writeStream.write(buf)
                })
                readStream.onError(err => {
                    reject(err)
                })
                readStream.onFinished(() => {
                    resolve()
                })
            })
        }
        await new Promise<void>((resolve, reject) => {
            writeStream.end(() => {
                const sha1Computed = shasum.digest('hex') as any as Sha1Hash
                if (sha1Computed !== sha1) {
                    /* istanbul ignore next */
                    {
                        /* istanbul ignore next */
                        {
                            reject(Error('Did not get the expected SHA-1 sum for concatenated file'))
                            return
                        }
                    }
                }
                resolve()
            })
        })
        if (fs.existsSync(destPath)) {
            // already exists
            /* istanbul ignore next */
            {
                fs.unlinkSync(tmpPath)
                return
            }
        }
        fs.mkdirSync(destParentPath, {recursive: true});
        fs.renameSync(tmpPath, destPath)
    }
    async getFileReadStream(fileKey: FileKey): Promise<DataStreamy> {
        if (fileKey.sha1) {
            const { path: filePath, size: fileSize } = await this._getLocalFileInfo(fileKey.sha1);
            if ((filePath) && (fileSize !== null)) {
                return createDataStreamForFile(filePath, byteCount(0), fileSize)
            }
        }
        if (fileKey.chunkOf) {
            const { path: filePath, size: fileSize } = await this._getLocalFileInfo(fileKey.chunkOf.fileKey.sha1)
            if (filePath) {
                const offset = fileKey.chunkOf.startByte
                const size = byteCount(byteCountToNumber(fileKey.chunkOf.endByte) - byteCountToNumber(fileKey.chunkOf.startByte))
                return createDataStreamForFile(filePath, offset, size)
            }
        }
        throw Error('Unable get data read stream for local file.')
    }
    async _getLocalFileInfo(fileSha1: Sha1Hash): Promise<{ path: LocalFilePath | null, size: ByteCount | null }> {
        const s = fileSha1;
        const path = localFilePath(`${this.#storageDir}/sha1/${s[0]}${s[1]}/${s[2]}${s[3]}/${s[4]}${s[5]}/${s}`)
        let stat0: fs.Stats
        try {
            stat0 = await fs.promises.stat(path.toString())
        }
        catch (err) {
            return { path: null, size: null }
        }
        return {
            path,
            size: byteCount(stat0.size)
        }
    }
    storageDir() {
        return this.#storageDir
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
    ret.producer().onCancelled(() => {
        readStream.close()
    })
    return ret
}

export const createTemporaryFilePath = (args: {storageDir: LocalFilePath, prefix: string}) => {
    const dirPath = args.storageDir + '/tmp'
    fs.mkdirSync(dirPath, {recursive: true})
    return `${dirPath}/${args.prefix}-${randomAlphaString(10)}`
}