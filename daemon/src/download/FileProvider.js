import fs from 'fs';
import assert from 'assert';
import { validateObject } from '../schema/index.js';
import crypto from 'crypto';

class FileProvider {
    constructor({node, findFileResult}) {
        assert(node, 'Missing node in constructor of FileProvider');
        validateObject(findFileResult, '/FindFileOrLiveFeedResult');

        this._node = node;
        this._findFileResult = findFileResult;
        this._fileSize = findFileResult.fileSize;
    }
    fileSize() {
        return this._fileSize;
    }
    nodeId() {
        return this._findFileResult.nodeId;
    }
    loadData({startByte, endByte, appendToFilePath=undefined, timeout}) {
        assert(typeof(startByte) === 'number', 'startByte is not a number in loadData');
        assert(typeof(endByte) === 'number', 'endByte is not a number in loadData');
        
        const onErrorCallbacks = [];
        const onFinishedCallbacks = [];
        const onProgressCallbacks = [];

        let complete = false;
        let appendToFileWriteStream = null;
        if (appendToFilePath) {
            appendToFileWriteStream = fs.createWriteStream(appendToFilePath, {flags: 'a+'});
        }

        const numBytesExpected = endByte - startByte;

        const chunks = [];
        var sha1sum = crypto.createHash('sha1')
        let numBytesLoaded = 0;

        const {stream, cancel: cancelDownload} = this._node._downloadFile({
            channelName: this._findFileResult.channel,
            nodeId: this._findFileResult.nodeId,
            fileKey: this._findFileResult.fileKey,
            startByte,
            endByte,
            timeout
        });
        assert(stream, 'stream is undefined in loadData');
        assert(typeof(cancelDownload) === 'function', 'cancelDownload is not a function in loadData');

        const _finalize = () => {
            complete = true;
            cancelDownload();
        }
        
        if (appendToFilePath) {
            stream.pipe(appendToFileWriteStream);
        }

        stream.on('error', (err) => {
            if (complete) return;
            _finalize();
            onErrorCallbacks.forEach(cb => cb(err));
        })
        stream.on('end', () => {
            if (complete) return;
            if (numBytesLoaded !== numBytesExpected) {
                const err = new Error('Stream ended before downloaded expected number of bytes.');
                onErrorCallbacks.forEach(cb => cb(err));
                return;
            }
            if (!appendToFilePath) {
                _finalize();
                const data = Buffer.concat(chunks);
                assert(data.length === numBytesExpected, 'Unexpected. Concatenated chunks do not have expected length.');
                const sha1 = sha1sum.digest('hex');
                onFinishedCallbacks.forEach(cb => cb({data, sha1}));
            }
        });
        if (appendToFilePath) {
            appendToFileWriteStream.on('finish', () => {
                if (complete) return;
                _finalize();
                const sha1 = sha1sum.digest('hex');
                onFinishedCallbacks.forEach(cb => cb({data: null, sha1}));
            });
        }
        let progressTimer = new Date();
        stream.on('data', data => {
            if (complete) return;
            numBytesLoaded += data.length;
            sha1sum.update(data);
            const progressElapsed = (new Date()) - progressTimer;
            if (progressElapsed >= 1000) {
                const prog = {
                    bytesLoaded: numBytesLoaded,
                    bytesTotal: numBytesExpected,
                    nodeId: this.nodeId()
                };
                onProgressCallbacks.forEach(cb => cb(prog));
                progressTimer = new Date();
            }
            if (!appendToFilePath) {
                chunks.push(data);
            }
        });

        const _handleCancel = () => {
            if (complete) return;
            _finalize();
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