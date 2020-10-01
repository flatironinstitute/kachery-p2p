import { FileKey } from "./interfaces/core";
import { getLocalFileInfo } from "./kachery";

interface LocalFilePath extends String {
    __localFilePath__: never // phantom
}
const localFilePath = (p: string) => {
    return p as any as LocalFilePath
}

export class KacheryStorageManager {
    constructor() {
        
    }
    async findFile(fileKey: FileKey): Promise<{found: boolean, size: bigint | null, localPath: LocalFilePath | null, byteOffset: bigint | null}> {
        if (fileKey.sha1) {
            const {path: filePath, size: fileSize} = await getLocalFileInfo(fileKey.sha1);
            if (filePath) {
                return {found: true, size: fileSize, localPath: localFilePath(filePath), byteOffset: BigInt(0)};
            }
        }
        if (fileKey.chunkOf) {
            const {found, size, localPath, byteOffset: offset1} = await this.findFile(fileKey.chunkOf.fileKey);
            if ((found) && (localPath !== null) && (offset1 !== null))  {
                return {found: true, size: fileKey.chunkOf.endByte - fileKey.chunkOf.startByte, localPath, byteOffset: offset1 + fileKey.chunkOf.startByte}
            }
        }
        return {found: false, size: null, localPath: null, byteOffset: null}
    }
}