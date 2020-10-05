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
    localPath: LocalFilePath | null,
    byteOffset: ByteCount | null
}

export class KacheryStorageManager {
    constructor() {
        
    }
    async findFile(fileKey: FileKey): Promise<FindFileReturnValue> {
        if (fileKey.sha1) {
            const {path: filePath, size: fileSize} = await getLocalFileInfo(fileKey.sha1);
            if (filePath) {
                return {found: true, size: fileSize, localPath: localFilePath(filePath), byteOffset: byteCount(0)};
            }
        }
        if (fileKey.chunkOf) {
            const {found, size, localPath, byteOffset: offset1} = await this.findFile(fileKey.chunkOf.fileKey);
            if ((found) && (localPath !== null) && (offset1 !== null))  {
                return {found: true, size: byteCount(byteCountToNumber(fileKey.chunkOf.endByte) - byteCountToNumber(fileKey.chunkOf.startByte)), localPath, byteOffset: byteCount(byteCountToNumber(offset1) + byteCountToNumber(fileKey.chunkOf.startByte))}
            }
        }
        return {found: false, size: null, localPath: null, byteOffset: null}
    }
}