import fs from 'fs';
import DataStreamy from "../common/DataStreamy";
import { ByteCount, byteCount, byteCountToNumber, FileKey } from "../interfaces/core";
import { getLocalFileInfo } from "./kachery";

export interface LocalFilePath extends String {
    __localFilePath__: never // phantom
}
export const localFilePath = (p: string) => {
    return p as any as LocalFilePath
}

const createDataStreamForFile = (path: LocalFilePath, offset: ByteCount, size: ByteCount) => {
    const readStream = fs.createReadStream(path.toString(), {encoding: 'binary', start: byteCountToNumber(offset), end: byteCountToNumber(offset) + byteCountToNumber(size)})
    const ret = new DataStreamy()
    ret._start(size)
    readStream.on('data', (chunk: Buffer) => {
        ret._data(chunk)
    })
    readStream.on('end', () => {
        ret._end()
    })
    readStream.on('error', (err: Error) => {
        ret._error(err)
    })
    return ret
}

export class KacheryStorageManager {
    constructor() {        
    }
    async findFile(fileKey: FileKey): Promise<{found: boolean, size: ByteCount}> {
        if (fileKey.sha1) {
            const {path: filePath, size: fileSize} = await getLocalFileInfo(fileKey.sha1);
            if ((filePath) && (fileSize !== null)) {
                return {found: true, size: fileSize}
            }
        }
        if (fileKey.chunkOf) {
            const {path: filePath, size: fileSize} = await getLocalFileInfo(fileKey.chunkOf.fileKey.sha1)
            if (filePath)  {
                const offset = fileKey.chunkOf.startByte
                const size = byteCount(byteCountToNumber(fileKey.chunkOf.endByte) - byteCountToNumber(fileKey.chunkOf.startByte))
                return {found: true, size }
            }
        }
        return {found: false, size: byteCount(0)}
    }
    async getFileReadStream(fileKey: FileKey): Promise<DataStreamy> {
        if (fileKey.sha1) {
            const {path: filePath, size: fileSize} = await getLocalFileInfo(fileKey.sha1);
            if ((filePath) && (fileSize !== null)) {
                return createDataStreamForFile(localFilePath(filePath), byteCount(0), fileSize)
            }
        }
        if (fileKey.chunkOf) {
            const {path: filePath, size: fileSize} = await getLocalFileInfo(fileKey.chunkOf.fileKey.sha1)
            if (filePath)  {
                const offset = fileKey.chunkOf.startByte
                const size = byteCount(byteCountToNumber(fileKey.chunkOf.endByte) - byteCountToNumber(fileKey.chunkOf.startByte))
                return createDataStreamForFile(localFilePath(filePath), offset, size)
            }
        }
        throw Error('Unable get data read stream for local file.')
    }
}