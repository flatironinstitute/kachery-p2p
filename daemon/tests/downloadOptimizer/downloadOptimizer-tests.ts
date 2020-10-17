import { expect } from 'chai';
import * as mocha from 'mocha'; // import types for mocha e.g. describe
import DataStreamy from '../../src/common/DataStreamy';
import { sleepMsec } from '../../src/common/util';
import DownloadOptimizer from '../../src/downloadOptimizer/DownloadOptimizer';
import DownloadOptimizerJob from '../../src/downloadOptimizer/DownloadOptimizerJob';
import { FileKey, NodeId, Sha1Hash } from '../../src/interfaces/core';
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
    createDownloader(args: {fileKey: FileKey, nodeId: NodeId}): DataStreamy {
        const downloader = new DataStreamy()
        setTimeout(() => {
            downloader._start(byteCount(100))
            if (args.fileKey.sha1 === exampleErrorFileKey.sha1) {
                downloader._error(Error('MockError'))
            }
            else if (args.fileKey.sha1 === exampleLongDurationFileKey.sha1) {
                setTimeout(() => {
                    downloader._reportBytesLoaded(byteCount(100))
                    downloader._end()
                }, 2000)
            }
            else {
                downloader._reportBytesLoaded(byteCount(100))
                downloader._end()
            }
        }, 2)
        return downloader
    }
}

 // need to explicitly use mocha prefix once or the dependency gets wrongly cleaned up
 mocha.describe('downloadOptimizer', () => {
    describe('Add file ahvr', () => {
        it('Add file', (done) => {
            (async () => {
                const fileKey = exampleFileKey
                const downloaderCreator = new MockDownloaderCreator()
                const downloadOptimizer = new DownloadOptimizer(downloaderCreator)
                const f: DownloadOptimizerJob = downloadOptimizer.addFile(fileKey, byteCount(100))
                let gotProgress = false
                f.incrementNumPointers()
                f.onProgress((progress) => {
                    gotProgress = true
                })
                f.onFinished(() => {
                    expect(gotProgress).is.true
                    expect(f.bytesLoaded()).to.equal(byteCount(100))
                    done()
                })
                f.onError((err: Error) => {
                    throw err
                })
                await sleepMsec(2)
                downloadOptimizer.setProviderNodeForFile({fileKey, nodeId: exampleNodeId1})
                downloadOptimizer.setProviderNodeForFile({fileKey, nodeId: exampleNodeId2})
            })()
        });
        it('Add error file', (done) => {
            (async () => {
                const fileKey = exampleErrorFileKey
                const downloaderCreator = new MockDownloaderCreator()
                const downloadOptimizer = new DownloadOptimizer(downloaderCreator)
                const f: DownloadOptimizerJob = downloadOptimizer.addFile(fileKey, null)
                f.incrementNumPointers()
                f.onFinished(() => {
                    throw Error('Did not get the expected error')
                })
                f.onError((err: Error) => {
                    // todo: check the error type
                    done()
                })
                await sleepMsec(2)
                downloadOptimizer.setProviderNodeForFile({fileKey, nodeId: exampleNodeId1})
                downloadOptimizer.setProviderNodeForFile({fileKey, nodeId: exampleNodeId2})
            })()
        });
    })
 })