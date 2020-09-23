import { FileKey } from "./interfaces/core";
import { getLocalFileInfo } from "./kachery";

export class KacheryStorageManager {
    constructor() {
        
    }
    async hasFile(fileKey: FileKey): Promise<{found: boolean, size: bigint | null}> {
        if (fileKey.sha1) {
            const {path: filePath, size: fileSize} = await getLocalFileInfo(fileKey.sha1);
            if (filePath) {
                return {found: true, size: fileSize};
            }
        }
        if (fileKey.chunkOf) {
            const {found, size} = await this.hasFile(fileKey.chunkOf.fileKey);
            if (found) {
                return {found: true, size: fileKey.chunkOf.endByte - fileKey.chunkOf.startByte};
            }
        }
        return {found: false, size: null}
    }
}