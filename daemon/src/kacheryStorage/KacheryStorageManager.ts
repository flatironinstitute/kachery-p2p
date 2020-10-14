import fs from 'fs';
import DataStreamy from "../common/DataStreamy";
import { FileKey } from "../interfaces/core";
import { ByteCount, byteCount, byteCountToNumber } from "../udp/UdpCongestionManager";
import { getLocalFileInfo } from "./kachery";

export interface LocalFilePath extends String {
    __localFilePath__: never // phantom
}
export const localFilePath = (p: string) => {
    return p as any as LocalFilePath
}

export interface FindFileReturnValue {
    found: boolean,
    size: ByteCount | null,
    dataStream: DataStreamy | null
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
    async findFile(fileKey: FileKey, returnStream: boolean): Promise<FindFileReturnValue> {
        if (fileKey.sha1) {
            const {path: filePath, size: fileSize} = await getLocalFileInfo(fileKey.sha1);
            if ((filePath) && (fileSize !== null)) {
                const dataStream = returnStream ? createDataStreamForFile(localFilePath(filePath), byteCount(0), fileSize) : null
                return {found: true, size: fileSize, dataStream}
            }
        }
        if (fileKey.chunkOf) {
            const {path: filePath, size: fileSize} = await getLocalFileInfo(fileKey.chunkOf.fileKey.sha1)
            if (filePath)  {
                const offset = fileKey.chunkOf.startByte
                const size = byteCount(byteCountToNumber(fileKey.chunkOf.endByte) - byteCountToNumber(fileKey.chunkOf.startByte))
                const dataStream = returnStream ? createDataStreamForFile(localFilePath(filePath), offset, size) : null
                return {found: true, size, dataStream }
            }
        }
        return {found: false, size: null, dataStream: null}
    }
}