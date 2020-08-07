import fs from 'fs';
import { validateObject } from '../schema/index.js';

class FileProvider {
    constructor({node, findFileResult}) {
        assert(node, 'Missing node in constructor of FileProvider');
        validateObject(findFileResult, '/FindFileOrLiveFeedResult');
        validateObject(findFileResult.fileInfo, '/FileInfo');

        this._node = node;
        this._findFileResult = findFileResult;
        this._fileInfo = findFileResult.fileInfo;
    }
    fileSize() {
        return this._fileInfo.size;
    }
    nodeId() {
        return this._findFileResult.nodeId;
    }
    loadData({startByte, endByte, appendToFilePath=undefined}) {
        assert(typeof(startByte) === 'number', 'startByte is not a number in loadData');
        assert(typeof(endByte) === 'number', 'endByte is not a number in loadData');
        
        const onErrorCallbacks = [];
        const onFinishedCallbacks = [];
        const onProgressCallbacks = [];

        let complete = false;
        let appendToFile = null;
        if (appendToFile) {
            appendToFile = fs.openSync(appendToFilePath, 'a+');
        }

        const {stream, cancel} = this._node.downloadFile({
            channelName: this._findFileResult.channel,
            nodeId: this._findFileResult.nodeId,
            fileKey: this._findFileResult.fileKey,
            startByte,
            endByte
        });

        const numBytesExpected = endByte - startByte;

        const chunks = [];
        var sha1sum = crypto.createHash('sha1')
        let numBytesLoaded = 0;

        const _finalize = () => {
            if (appendToFile) {
                fs.closeSync(appendToFile);
            }
            complete = true;
        }

        stream.on('error', (err) => {
            if (complete) return;
            _finalize();
            onErrorCallbacks.forEach(cb => cb(err));
        })
        stream.on('close', () => {
            if (complete) return;
            _finalize();
            if (numBytesLoaded !== numBytesExpected) {
                const err = new Error('Stream closed before downloaded expected number of bytes.');
                onErrorCallbacks.forEach(cb => cb(err));
                return;
            }
            let data = null;
            if (!appendToFilePath) {
                data = Buffer.concat(chunks);
            }
            assert(data.length === numBytesExpected, 'Unexpected. Concatenated chunks do not have expected length.');
            const sha1 = sha1sum.digest('hex');
            onFinishedCallbacks.forEach(cb => cb({data, sha1}));
        });
        stream.on('data', data => {
            if (complete) return;
            numBytesLoaded += data.length;
            sha1sum.update(data);
            if (appendToFilePath) {
                fs.write(appendToFile, data);
            }
            else {
                chunks.push(data);
            }
        });

        const _handleCancel = () => {
            if (complete) return;
            _finalize();
            stream.close();
        }

        return {
            onError: (cb) => onErrorCallbacks.push(cb),
            onFinished: (cb) => onFinishedCallbacks.push(cb),
            onProgress: (cb) => onProgressCallbacks.push(cb),
            cancel: () => _handleCancel()
        };
    }
}

export default FileProvider;