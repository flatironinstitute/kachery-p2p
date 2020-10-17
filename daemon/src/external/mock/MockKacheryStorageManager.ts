import crypto from 'crypto'
import DataStreamy from "../../common/DataStreamy"
import { byteCount, ByteCount, FileKey, Sha1Hash } from "../../interfaces/core"

export default class MockKacheryStorageManager {
    #mockFiles = new Map<Sha1Hash, Buffer>() 
    async findFile(fileKey: FileKey):  Promise<{found: boolean, size: ByteCount}> {
        const content = this.#mockFiles.get(fileKey.sha1)
        if (content) {
            return {
                found: true,
                size: byteCount(content.length)
            }
        }
        else {
            return {
                found: false,
                size: byteCount(0)
            }
        }
    }
    async getFileReadStream(fileKey: FileKey): Promise<DataStreamy> {
        const content = this.#mockFiles.get(fileKey.sha1)
        if (content) {
            const ret = new DataStreamy()
            setTimeout(() => {
                ret._start(byteCount(content.length))
                ret._data(content)
                ret._end()
            }, 2)
            return ret
        }
        else {
            throw Error('File not found')
        }
    }
    addMockFile(content: Buffer): FileKey {
        const shasum = crypto.createHash('sha1')
        shasum.update(content)
        const sha1 = shasum.digest('hex') as any as Sha1Hash
        this.#mockFiles.set(sha1, content)
        return {
            sha1
        }
    }
}
