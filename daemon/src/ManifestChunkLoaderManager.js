class ManifestChunkLoaderManager {
    constructor({numSimultaneous}) {
        this._numSimultaneous = numSimultaneous;
        this._chunks = [];
    }
    addChunk({index, chunkFileKey}) {
        this._chunks.push({
            index,
            chunkFileKey
        });
    }
    onProgress(cb) {
        this._onProgressCallbacks.push(cb);
    }
    onError(cb) {
        this._onErrorCallbacks.push(cb);
    }
    onFinished(cb) {
        this._onFinishedCallbacks.push(cb);
    }
    start() {
        const chunkPaths = [];
        let lastProg = {};
        for (let ichunk = 0; ichunk < manifest.chunks.length; ichunk++) {
            if (done) return;
            const chunk = manifest.chunks[ichunk];
            console.info(`Loading chunk ${ichunk + 1} of ${manifest.chunks.length} (${chunk.end - chunk.start} bytes)`);
            // todo: report progress here
            const chunkFileKey = {
                sha1: chunk.sha1,
                chunkOf: {
                    fileKey: {
                        sha1: manifest.sha1
                    },
                    startByte: chunk.start,
                    endByte: chunk.end
                }
            };
            const _handleChunkProgress = ((prog) => {
                lastProg = prog;
                const pr0 = {
                    bytesLoaded: bytesLoaded + prog.bytesLoaded,
                    bytesTotal: manifest.size,
                    nodeId: prog.nodeId
                }
                onProgressCallbacks.forEach(cb => cb(pr0));
                progressTimer = new Date();
            });
            const chunkPath = await this._loadFileAsync({fileKey: chunkFileKey, onProgress: _handleChunkProgress});
            bytesLoaded += chunk.end - chunk.start;
            const pr = {
                bytesLoaded,
                bytesTotal: manifest.size,
                nodeId: lastProg.nodeId || ''
            }
            const progressElapsed = (new Date()) - progressTimer;
            if (progressElapsed >= 1000) {
                onProgressCallbacks.forEach(cb => cb(pr));
                progressTimer = new Date();
            }
            chunkPaths.push(chunkPath);                    
        }
    }
}