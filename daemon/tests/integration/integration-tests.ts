import { expect } from 'chai';
import * as mocha from 'mocha'; // import types for mocha e.g. describe
import { sleepMsec } from '../../src/common/util';
import MockNodeDaemon, { MockNodeDaemonGroup, MockNodeDefects } from '../../src/external/mock/MockNodeDaemon';
import { byteCount, ByteCount, byteCountToNumber, ChannelName, FeedName, messageCount, scaledDurationMsec, SubfeedAccessRules, SubfeedHash, SubfeedMessage, subfeedPosition, SubmittedSubfeedMessage, toPort } from '../../src/interfaces/core';
import { ApiLoadFileRequest } from '../../src/services/DaemonApiServer';
import { StartDaemonOpts } from '../../src/startDaemon';

const mockChannelName = 'mock-channel' as any as ChannelName


const testContext = (testFunction: (g: MockNodeDaemonGroup, resolve: () => void, reject: (err: Error) => void) => Promise<void>, done: (err?: Error) => void) => {
    const g = new MockNodeDaemonGroup()
    const resolve = () => {
        g.stop()
        done()
    }
    const reject = (err: Error) => {
        g.stop()
        done(err)
    }
    testFunction(g, resolve, reject).then(() => {
    }).catch((err: Error) => {
        reject(err)
    })
}

 // need to explicitly use mocha prefix once or the dependency gets wrongly cleaned up
 mocha.describe('Integration', () => {
    describe('Test connect to bootstrap node aaa01', () => {
        it('Create this node and bootstrap node', (done) => {
            testContext(async (g, resolve, reject) => {
                const bootstrapOpts: StartDaemonOpts = {
                    bootstrapAddresses: [],
                    isBootstrap: true,
                    channelNames: [],
                    multicastUdpAddress: null,
                    udpSocketPort: null,
                    webSocketListenPort: null,
                    firewalled: false,
                    services: {
                    }
                }
                const daemonOpts: StartDaemonOpts = {
                    bootstrapAddresses: [],
                    isBootstrap: false,
                    channelNames: [mockChannelName],
                    multicastUdpAddress: null,
                    udpSocketPort: null,
                    webSocketListenPort: null,
                    firewalled: true,
                    services: {
                        announce: true,
                        discover: true,
                        bootstrap: true
                    }
                }
                const bootstrapDaemon = await g.createDaemon({...bootstrapOpts})
                const daemon1 = await g.createDaemon({...daemonOpts, bootstrapAddresses: [bootstrapDaemon.address()]})

                // wait a bit
                await sleepMsec(scaledDurationMsec(60000))

                // we expect to have one bootstrap node
                expect(daemon1.remoteNodeManager().getBootstrapRemoteNodes().length).equals(1)
                const remoteBootstrapNode = daemon1.remoteNodeManager().getBootstrapRemoteNodes()[0]

                // Check that the node ID matches
                expect(remoteBootstrapNode.remoteNodeId()).equals(bootstrapDaemon.nodeId())

                // Check that the bootstrap node is aware of this node
                expect(bootstrapDaemon.remoteNodeManager().getAllRemoteNodes().length).equals(1)
                const remoteThisNode = bootstrapDaemon.remoteNodeManager().getAllRemoteNodes()[0]
                expect(remoteThisNode.remoteNodeId()).equals(daemon1.nodeId())
                expect(remoteThisNode.getChannelNames().includes(mockChannelName)).is.true

                resolve()
            }, done)
        })
        // it('Find file on bootstrap node', (done) => {
        //     testContext(async (g, resolve, reject) => {
        //         const bootstrapOpts: StartDaemonOpts = {
        //             bootstrapAddresses: [],
        //             isBootstrap: true,
        //             channelNames: [mockChannelName],
        //             multicastUdpAddress: null,
        //             udpSocketPort: null,
        //             webSocketListenPort: null,
        //             services: {
        //             }
        //         }
        //         const daemonOpts = {
        //             bootstrapAddresses: [],
        //             isBootstrap: false,
        //             channelNames: [mockChannelName],
        //             multicastUdpAddress: null,
        //             udpSocketPort: null,
        //             webSocketListenPort: null,
        //             mock: true,
        //             services: {
        //                 announce: true,
        //                 discover: true,
        //                 bootstrap: true
        //             }
        //         }
        //         const bootstrapDaemon = await g.createDaemon({...bootstrapOpts})
        //         const daemon1 = await g.createDaemon({...daemonOpts, bootstrapAddresses: [bootstrapDaemon.address()]})

        //         const f1Content = Buffer.from('123456')
        //         const f1Key = bootstrapDaemon.mockKacheryStorageManager().addMockFile(f1Content, {chunkSize: byteCount(1000)})

        //         // wait a bit
        //         await sleepMsec(durationMsec(15000))

        //         expect(daemon1.remoteNodeManager().getBootstrapRemoteNodes().length).equals(1)

        //         let numFound = 0
        //         const a = await daemon1.mockDaemonPostFindFile({
        //             fileKey: f1Key,
        //             timeoutMsec: durationMsec(100),
        //             fromChannel: null
        //         })
        //         a.onFinished(() => {
        //             expect(numFound).equals(1)
        //             resolve()
        //         })
        //         a.onFound((result) => {
        //             expect(result.fileKey.sha1).equals(f1Key.sha1)
        //             numFound ++
        //         })
        //     }, done)
        // })
    })
    describe('Test multicast udp discovery aaa89', () => {
        it('Create two nodes communicating through multicast sockets', (done) => {
            testContext(async (g, resolve, reject) => {
                const multicastUdpAddress = 'local-mock-multicast-udp-address-1'
                const daemonOpts = {
                    bootstrapAddresses: [],
                    isBootstrap: false,
                    channelNames: [mockChannelName],
                    multicastUdpAddress,
                    udpSocketPort: 'x', // random below
                    webSocketListenPort: null,
                    firewalled: true,
                    services: {
                        announce: true,
                        discover: true,
                        multicast: true,
                        udpSocket: true
                    }
                }
                const daemon1 = await g.createDaemon({...daemonOpts, udpSocketPort: randomMockPort()})
                const daemon2 = await g.createDaemon({...daemonOpts, udpSocketPort: randomMockPort()})

                // wait a bit
                await sleepMsec(scaledDurationMsec(60000))

                // // we expect to have one remote node now
                expect(daemon1.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).equals(1)
                expect(daemon2.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).equals(1)

                await testFindFile(daemon1, daemon2)
                await testLoadFile(daemon1, daemon2)
                await testLoadFileWithDefects(daemon1, daemon2)
                await testSubfeedMessage(daemon1, daemon2)
                await testSubmitSubfeedMessage(daemon1, daemon2)

                resolve()
            }, done)
        }).timeout(10000)
    })
    describe('Test proxy connections', () => {
        it('Create two nodes communicating through proxy server aaa90', (done) => {
            testContext(async (g, resolve, reject) => {
                const bootstrapOpts: StartDaemonOpts = {
                    bootstrapAddresses: [],
                    isBootstrap: true,
                    channelNames: [],
                    multicastUdpAddress: null,
                    udpSocketPort: null,
                    webSocketListenPort: randomMockPort(),
                    firewalled: false,
                    services: {
                        webSocketServer: true
                    }
                }
                const daemonOpts: StartDaemonOpts = {
                    bootstrapAddresses: [],
                    isBootstrap: false,
                    channelNames: [mockChannelName],
                    multicastUdpAddress: null,
                    udpSocketPort: null,
                    webSocketListenPort: null,
                    firewalled: true,
                    services: {
                        announce: true,
                        discover: true,
                        bootstrap: true,
                        proxyClient: true
                    }
                }
                const bootstrapDaemon = await g.createDaemon({...bootstrapOpts})
                bootstrapDaemon.setDefects({
                    disconnectIncomingProxyConnectionOnce: true
                })
                const daemon1 = await g.createDaemon({...daemonOpts, bootstrapAddresses: [bootstrapDaemon.address()]})
                const daemon2 = await g.createDaemon({...daemonOpts, bootstrapAddresses: [bootstrapDaemon.address()]})

                // wait a bit
                await sleepMsec(scaledDurationMsec(60000))

                // // we expect to have one remote node now
                expect(daemon1.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).equals(1)
                expect(daemon2.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).equals(1)

                await testFindFile(daemon1, daemon2)
                await testLoadFile(daemon1, daemon2)
                await testLoadFileWithDefects(daemon1, daemon2)
                await testSubfeedMessage(daemon1, daemon2)

                resolve()
            }, done)
        }).timeout(10000)
    })
    describe('Test udp connections', () => {
        it('Create two nodes communicating through udp aaa91', (done) => {
            testContext(async (g, resolve, reject) => {
                const bootstrapOpts: StartDaemonOpts = {
                    bootstrapAddresses: [],
                    isBootstrap: true,
                    channelNames: [],
                    multicastUdpAddress: null,
                    udpSocketPort: randomMockPort(),
                    webSocketListenPort: randomMockPort(),
                    firewalled: false,
                    services: {
                        httpServer: true,
                        udpSocket: true,
                        webSocketServer: true
                    }
                }
                const daemonOpts: StartDaemonOpts = {
                    bootstrapAddresses: [],
                    isBootstrap: false,
                    channelNames: [mockChannelName],
                    multicastUdpAddress: null,
                    udpSocketPort: null, // determined below
                    webSocketListenPort: null,
                    firewalled: true,
                    services: {
                        announce: true,
                        discover: true,
                        bootstrap: true,
                        udpSocket: true,
                        proxyClient: true
                    }
                }
                const bootstrapDaemon = await g.createDaemon({...bootstrapOpts})
                const daemon1 = await g.createDaemon({...daemonOpts, bootstrapAddresses: [bootstrapDaemon.address()], udpSocketPort: randomMockPort()})
                const daemon2 = await g.createDaemon({...daemonOpts, bootstrapAddresses: [bootstrapDaemon.address()], udpSocketPort: randomMockPort()})

                // wait a bit
                await sleepMsec(scaledDurationMsec(60000))

                // // we expect to have one remote node now
                expect(daemon1.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).equals(1)
                expect(daemon2.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).equals(1)

                daemon1.setDefects({
                    udpPacketLossNum: 5
                })
                daemon2.setDefects({
                    udpPacketLossNum: 5
                })

                await testFindFile(daemon1, daemon2)
                await testLoadFile(daemon1, daemon2)
                await testLoadFileWithDefects(daemon1, daemon2)
                await testSubfeedMessage(daemon1, daemon2)

                daemon1.clearDefects()
                daemon2.clearDefects()

                resolve()
            }, done)
        })
        it('Test udp socket creation error aaa92', (done) => {
            testContext(async (g, resolve, reject) => {
                const bootstrapOpts: StartDaemonOpts = {
                    bootstrapAddresses: [],
                    isBootstrap: true,
                    channelNames: [],
                    multicastUdpAddress: null,
                    udpSocketPort: randomMockPort(),
                    webSocketListenPort: randomMockPort(),
                    firewalled: false,
                    services: {
                        httpServer: true,
                        udpSocket: true,
                        webSocketServer: true
                    }
                }
                const daemonOpts: StartDaemonOpts = {
                    bootstrapAddresses: [],
                    isBootstrap: false,
                    channelNames: [mockChannelName],
                    multicastUdpAddress: null,
                    udpSocketPort: null, // determined below
                    webSocketListenPort: null,
                    firewalled: true,
                    services: {
                        announce: true,
                        discover: true,
                        bootstrap: true,
                        udpSocket: true,
                        proxyClient: true
                    }
                }
                const bootstrapDaemon = await g.createDaemon({...bootstrapOpts})
                const daemon1Defects: MockNodeDefects = {createUdpSocketDefect: true}
                try {
                    const daemon1 = await g.createDaemon({...daemonOpts, bootstrapAddresses: [bootstrapDaemon.address()], udpSocketPort: randomMockPort()}, daemon1Defects)
                    await sleepMsec(scaledDurationMsec(60000))
                    throw Error('Did not get expected exception')
                }
                catch(err) {
                    if (!err.message.includes('Intentional error creating socket due to defect')) {
                        throw(err)
                    }
                }                

                resolve()
            }, done)
        })
    })
 })

const testFindFile = async (daemon1: MockNodeDaemon, daemon2: MockNodeDaemon) => {
    const f1Content = Buffer.from('123456')
    const f1Key = daemon1.mockKacheryStorageManager().addMockFile(f1Content, {chunkSize: byteCount(1000)})

    let numFound = 0
    const a = await daemon2.mockDaemonPostFindFile({
        fileKey: f1Key,
        timeoutMsec: scaledDurationMsec(5000),
        fromChannel: null
    })
    return new Promise((resolve, reject) => {
        a.onFinished(() => {
            expect(numFound).equals(1)
            resolve()
        })
        a.onFound((result) => {
            expect(result.fileKey.sha1).equals(f1Key.sha1)
            numFound ++
        })
    })
}

const testLoadFile = async (daemon1: MockNodeDaemon, daemon2: MockNodeDaemon, fileSize: ByteCount = byteCount(20000), chunkSize: ByteCount = byteCount(1200)) => {
    const f1Content = Buffer.alloc(byteCountToNumber(fileSize), 'a')
    const f1Key = daemon1.mockKacheryStorageManager().addMockFile(f1Content, {chunkSize})

    await new Promise((resolve, reject) => {
        const reqData: ApiLoadFileRequest = {
            fileKey: f1Key,
            fromChannel: null,
            fromNode: null
        }
        const x = daemon2.mockDaemonApiServer().mockPostLoadFile(reqData)
        x.onError(err => {
            reject(err)
        })
        x.onFinished(() => {
            resolve()
        })
    })
    const f = await daemon2.mockKacheryStorageManager().findFile(f1Key)
    expect(f.found).is.true
}

const testLoadFileWithDefects = async (daemon1: MockNodeDaemon, daemon2: MockNodeDaemon, fileSize: ByteCount = byteCount(20000), chunkSize: ByteCount = byteCount(1200)) => {
    const f1Content = Buffer.alloc(byteCountToNumber(fileSize), 'a')
    const f2Content = Buffer.alloc(byteCountToNumber(fileSize), 'b')
    const f1Key = daemon1.mockKacheryStorageManager().addMockFile(f1Content, {chunkSize})
    const f2Key = daemon1.mockKacheryStorageManager().addMockFile(f2Content, {chunkSize})

    daemon1.setDefects({
        fileReadDefect: true
    })

    try {
        await new Promise((resolve, reject) => {
            const reqData: ApiLoadFileRequest = {
                fileKey: f1Key,
                fromChannel: null,
                fromNode: null
            }
            const x = daemon2.mockDaemonApiServer().mockPostLoadFile(reqData)
            x.onError(err => {
                reject(err)
            })
            x.onFinished(() => {
                resolve()
            })
        })
        throw Error('Did not get fileReadDefect error')
    }
    catch(err) {
        if (err.message !== 'fileReadDefect') {
            throw(err)
        }
    }

    daemon1.clearDefects()
    daemon2.setDefects({
        badDownloadFileDataRequest: true
    })

    try {
        await new Promise((resolve, reject) => {
            const reqData: ApiLoadFileRequest = {
                fileKey: f2Key,
                fromChannel: null,
                fromNode: null
            }
            const x = daemon2.mockDaemonApiServer().mockPostLoadFile(reqData)
            x.onError(err => {
                reject(err)
            })
            x.onFinished(() => {
                resolve()
            })
        })
        throw Error('Did not get expected error')
    }
    catch(err) {
        if (err.message !== 'Unable to stream file data') {
            throw err
        }
    }

    daemon1.clearDefects()
    daemon2.clearDefects()
}

const testSubfeedMessage = async (daemon1: MockNodeDaemon, daemon2: MockNodeDaemon) => {
    const fm1 = daemon1.feedManager()
    const fm2 = daemon2.feedManager()

    const feed1 = await fm1.createFeed({feedName: 'f1' as any as FeedName})
    const sf1 = '0123456789012345678901234567890123456789' as any as SubfeedHash
    await fm1.appendMessages({feedId: feed1, subfeedHash: sf1, messages: [{test: 42} as any as SubfeedMessage]})
    await fm1.submitMessage({feedId: feed1, subfeedHash: sf1, message: {test: 420} as any as SubmittedSubfeedMessage, timeoutMsec: scaledDurationMsec(5000)})
    const messages = await fm1.getMessages({feedId: feed1, subfeedHash: sf1, position: subfeedPosition(0), maxNumMessages: messageCount(10), waitMsec: scaledDurationMsec(1000)})
    expect(messages.length).equals(2)
    expect(messages[0].test).equals(42)

    // do this first line so that we can test the simultaneous loading of the same subfeed (code coverage)
    const p1 =fm2.getMessages({feedId: feed1, subfeedHash: sf1, position: subfeedPosition(0), maxNumMessages: messageCount(10), waitMsec: scaledDurationMsec(1000)})
    const messages2 = await fm2.getMessages({feedId: feed1, subfeedHash: sf1, position: subfeedPosition(0), maxNumMessages: messageCount(10), waitMsec: scaledDurationMsec(1000)})
    const messages2b = await p1
    expect(messages2.length).equals(2)
    expect(messages2b.length).equals(2)
    expect(messages2[0].test).equals(42)
    expect(await fm2.getNumMessages({feedId: feed1, subfeedHash: sf1})).to.equal(2)

    const fi = await fm2.getFeedInfo({feedId: feed1, timeoutMsec: scaledDurationMsec(5000)})
    expect(fi.nodeId).equals(daemon1.nodeId())
    const fi2 = await fm1.getFeedInfo({feedId: feed1, timeoutMsec: scaledDurationMsec(5000)})
    expect(fi2.nodeId).equals(daemon1.nodeId())

    try {
        await fm2.appendMessages({feedId: feed1, subfeedHash: sf1, messages: [{test: 43} as any as SubfeedMessage]})
        throw Error('Did not get expected error')
    }
    catch(err) {
        if (!err.message.includes('Subfeed is not writeable')) {
            throw(err)
        }
    }

    expect(await fm1.hasWriteableFeed({feedId: feed1})).is.true
    const feed1b = await fm1.getFeedId({feedName: 'f1' as any as FeedName})
    expect(feed1b).equals(feed1)
    await fm1.deleteFeed({feedId: feed1})
    expect(await fm1.hasWriteableFeed({feedId: feed1})).is.false
}

const testSubmitSubfeedMessage = async (daemon1: MockNodeDaemon, daemon2: MockNodeDaemon) => {
    const fm1 = daemon1.feedManager()
    const fm2 = daemon2.feedManager()

    const feed1 = await fm1.createFeed({feedName: 'f1' as any as FeedName})
    const sf1 = '0123456789012345678901234567890123456789' as any as SubfeedHash
    const accessRules: SubfeedAccessRules = {
        rules: [
            {
                nodeId: daemon2.nodeId(),
                write: true
            }
        ]
    }
    
    try {
        await fm2.submitMessage({feedId: feed1, subfeedHash: sf1, message: {test: 41} as any as SubmittedSubfeedMessage, timeoutMsec: scaledDurationMsec(1000)})
        throw Error('Did not get submit message permission denied error')
    }
    catch(err) {       
        if (!err.message.includes('Error submitting message to remote live feed: Permission denied')) { 
            throw Error(err)
        }
    }
    fm1.setAccessRules({feedId: feed1, subfeedHash: sf1, accessRules: accessRules})
    await fm2.submitMessage({feedId: feed1, subfeedHash: sf1, message: {test: 42} as any as SubmittedSubfeedMessage, timeoutMsec: scaledDurationMsec(1000)})
    const messages = await fm1.getMessages({feedId: feed1, subfeedHash: sf1, position: subfeedPosition(0), maxNumMessages: messageCount(10), waitMsec: scaledDurationMsec(1000)})
    expect(messages.length).equals(1)
    expect(messages[0].test).equals(42)

    const ar1 = await fm1.getAccessRules({feedId: feed1, subfeedHash: sf1})
    if (!ar1) {
        throw(Error('Unable to get access rules'))
    }
    expect(ar1.rules.length).equals(1)
    try {
        const ar2 = await fm2.getAccessRules({feedId: feed1, subfeedHash: sf1})
        throw Error('Did not get expected error')
    }
    catch(err) {
        if (!err.message.includes('Cannot get access rules for subfeed that is not writeable')) {
            throw(err)
        }
    }

    try {
        await fm2.setAccessRules({feedId: feed1, subfeedHash: sf1, accessRules: ar1})
        throw Error('Did not get expected error')
    }
    catch(err) {
        if (!err.message.includes('Cannot set access rules for subfeed that is not writeable')) {
            throw(err)
        }
    }
}

let lastMockPort = 0
const randomMockPort = () => {
    lastMockPort ++
    return toPort(lastMockPort)
}