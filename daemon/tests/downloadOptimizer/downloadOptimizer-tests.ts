import * as mocha from 'mocha'; // import types for mocha e.g. describe
import { sleepMsec } from '../../src/common/util';
import DownloadOptimizer from '../../src/downloadOptimizer/DownloadOptimizer';
import DownloadOptimizerJob from '../../src/downloadOptimizer/DownloadOptimizerJob';
import { FileKey, NodeId, Sha1Hash } from '../../src/interfaces/core';
import { LoadFileProgress } from '../../src/KacheryP2PNode';
import { byteCount } from '../../src/udp/UdpCongestionManager';

const exampleFileKey: FileKey = {
    sha1: '782c1e65b839d37d9d69768d226a2f66ce135c02' as any as Sha1Hash
}
const exampleErrorFileKey: FileKey = {
    sha1: '000000000839d37d9d69768d226a2f66ce135c02' as any as Sha1Hash
}
const exampleLongDurationFileKey: FileKey = {
    sha1: '100000000839d37d9d69768d226a2f66ce135c02' as any as Sha1Hash
}
const exampleNodeId1: NodeId = 'example-node-id-1' as any as NodeId
const exampleNodeId2: NodeId = 'example-node-id-2' as any as NodeId

class MockDownloaderCreator {
    createDownloader(args: {fileKey: FileKey, nodeId: NodeId}) {
        const _onProgressCallbacks: ((progress: LoadFileProgress) => void)[] = []
        const _onFinishedCallbacks: (() => void)[] = []
        const _onErrorCallbacks: ((err: Error) => void)[] = []
        const _cancel = () => {}
        const downloader = {
            onProgress: (callback: (progress: LoadFileProgress) => void) => {_onProgressCallbacks.push(callback)},
            onError: (callback: (err: Error) => void) => {_onErrorCallbacks.push(callback)},
            onFinished: (callback: () => void) => {_onFinishedCallbacks.push(callback)},
            cancel: _cancel
        }
        setTimeout(() => {
            if (args.fileKey.sha1 === exampleErrorFileKey.sha1) {
                _onErrorCallbacks.forEach(cb => {cb(Error('MockError'))})
            }
            else if (args.fileKey.sha1 === exampleLongDurationFileKey.sha1) {
                setTimeout(() => {
                    _onFinishedCallbacks.forEach(cb => {cb()})
                }, 2000)
            }
            else {
                _onProgressCallbacks.forEach(cb => {
                    const progress: LoadFileProgress = {
                        bytesLoaded: byteCount(100),
                        bytesTotal: byteCount(100),
                        nodeId: args.nodeId
                    }
                    cb(progress)
                })
                _onFinishedCallbacks.forEach(cb => {cb()})
            }
        }, 2)
        return downloader
    }
}

 // need to explicitly use mocha prefix once or the dependency gets wrongly cleaned up
 mocha.describe('downloadOptimizer', () => {
    describe('Add file', () => {
        it('Add file', async () => {
            return new Promise((resolve, reject) => {
                (async () => {
                    const fileKey = exampleFileKey
                    const downloaderCreator = new MockDownloaderCreator()
                    const downloadOptimizer = new DownloadOptimizer(downloaderCreator)
                    const f: DownloadOptimizerJob = downloadOptimizer.addFile(fileKey, null)
                    let gotProgress = false
                    f.incrementNumPointers()
                    f.onProgress((progress) => {
                        gotProgress = true
                    })
                    f.onFinished(() => {
                        if (!gotProgress) {
                            reject(Error('Did not get progress.'))
                            return
                        }
                        if (f.bytesLoaded() !== byteCount(100)) {
                            reject(Error('Unexpected number of bytes loaded.'))
                            return
                        }
                        resolve()
                    })
                    f.onError((err: Error) => {
                        reject(err)
                    })
                    await sleepMsec(2)
                    downloadOptimizer.setProviderNodeForFile({fileKey, nodeId: exampleNodeId1})
                    downloadOptimizer.setProviderNodeForFile({fileKey, nodeId: exampleNodeId2})
                })()
            })
        });
        it('Add error file', async () => {
            return new Promise((resolve, reject) => {
                (async () => {
                    const fileKey = exampleErrorFileKey
                    const downloaderCreator = new MockDownloaderCreator()
                    const downloadOptimizer = new DownloadOptimizer(downloaderCreator)
                    const f: DownloadOptimizerJob = downloadOptimizer.addFile(fileKey, null)
                    f.incrementNumPointers()
                    f.onFinished(() => {
                        reject(Error('Did not get the expected error'))
                    })
                    f.onError((err: Error) => {
                        // todo: check the error type
                        resolve()
                    })
                    await sleepMsec(2)
                    downloadOptimizer.setProviderNodeForFile({fileKey, nodeId: exampleNodeId1})
                    downloadOptimizer.setProviderNodeForFile({fileKey, nodeId: exampleNodeId2})
                })()
            })
        });
    })
 })