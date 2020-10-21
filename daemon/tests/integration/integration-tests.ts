import { expect } from 'chai';
import * as mocha from 'mocha'; // import types for mocha e.g. describe
import { sleepMsec } from '../../src/common/util';
import MockNodeDaemon, { MockNodeDaemonGroup } from '../../src/external/mock/MockNodeDaemon';
import { byteCount, ByteCount, byteCountToNumber, ChannelName, durationMsec, FeedName, messageCount, SubfeedAccessRules, SubfeedHash, SubfeedMessage, subfeedPosition, SubmittedSubfeedMessage, toPort } from '../../src/interfaces/core';
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
    describe('Test connect to bootstrap node asdfasdf', () => {
        it('Create this node and bootstrap node', (done) => {
            testContext(async (g, resolve, reject) => {
                const bootstrapOpts: StartDaemonOpts = {
                    bootstrapAddresses: [],
                    isBootstrap: true,
                    channelNames: [],
                    multicastUdpAddress: null,
                    udpListenPort: null,
                    webSocketListenPort: null,
                    services: {
                    }
                }
                const daemonOpts: StartDaemonOpts = {
                    bootstrapAddresses: [],
                    isBootstrap: false,
                    channelNames: [mockChannelName],
                    multicastUdpAddress: null,
                    udpListenPort: null,
                    webSocketListenPort: null,
                    services: {
                        announce: true,
                        discover: true,
                        bootstrap: true
                    }
                }
                const bootstrapDaemon = await g.createDaemon({...bootstrapOpts})
                const daemon1 = await g.createDaemon({...daemonOpts, bootstrapAddresses: [bootstrapDaemon.address()]})
                // we expect to have no bootstrap nodes (yet)
                expect(daemon1.remoteNodeManager().getBootstrapRemoteNodes().length).equals(0)

                // wait a bit
                await sleepMsec(100)

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
        it('Find file on bootstrap node', (done) => {
            testContext(async (g, resolve, reject) => {
                const bootstrapOpts: StartDaemonOpts = {
                    bootstrapAddresses: [],
                    isBootstrap: true,
                    channelNames: [mockChannelName],
                    multicastUdpAddress: null,
                    udpListenPort: null,
                    webSocketListenPort: null,
                    services: {
                    }
                }
                const daemonOpts = {
                    bootstrapAddresses: [],
                    isBootstrap: false,
                    channelNames: [mockChannelName],
                    multicastUdpAddress: null,
                    udpListenPort: null,
                    webSocketListenPort: null,
                    mock: true,
                    services: {
                        announce: true,
                        discover: true,
                        bootstrap: true
                    }
                }
                const bootstrapDaemon = await g.createDaemon({...bootstrapOpts})
                const daemon1 = await g.createDaemon({...daemonOpts, bootstrapAddresses: [bootstrapDaemon.address()]})

                const f1Content = Buffer.from('123456')
                const f1Key = bootstrapDaemon.mockKacheryStorageManager().addMockFile(f1Content, {chunkSize: byteCount(1000)})

                // wait a bit
                await sleepMsec(100)

                expect(daemon1.remoteNodeManager().getBootstrapRemoteNodes().length).equals(1)

                let numFound = 0
                const a = await daemon1.mockDaemonPostFindFile({
                    fileKey: f1Key,
                    timeoutMsec: durationMsec(100),
                    fromChannel: null
                })
                a.onFinished(() => {
                    expect(numFound).equals(1)
                    resolve()
                })
                a.onFound((result) => {
                    expect(result.fileKey.sha1).equals(f1Key.sha1)
                    numFound ++
                })
            }, done)
        })
    })
    describe('Test multicast udp discovery', () => {
        it('Create two nodes communicating through multicast sockets', (done) => {
            testContext(async (g, resolve, reject) => {
                const multicastUdpAddress = 'mock-multicast-udp-address-1'
                const daemonOpts = {
                    bootstrapAddresses: [],
                    isBootstrap: false,
                    channelNames: [mockChannelName],
                    multicastUdpAddress,
                    udpListenPort: 'x', // random below
                    webSocketListenPort: null,
                    services: {
                        multicast: true
                    }
                }
                const daemon1 = await g.createDaemon({...daemonOpts, udpListenPort: randomMockPort()})
                const daemon2 = await g.createDaemon({...daemonOpts, udpListenPort: randomMockPort()})
                // // we expect to have no remote nodes yet
                expect(daemon1.remoteNodeManager().getAllRemoteNodes().length).equals(0)
                expect(daemon2.remoteNodeManager().getAllRemoteNodes().length).equals(0)

                // // wait a bit
                await sleepMsec(50)

                // // we expect to have one remote node now
                expect(daemon1.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).equals(1)
                expect(daemon2.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).equals(1)

                await testFindFile(daemon1, daemon2)
                // await testLoadFile(daemon1, daemon2)
                await testSubfeedMessage(daemon1, daemon2)
                await testSubmitSubfeedMessage(daemon1, daemon2)

                resolve()
            }, done)
        })
        it('Find file between two local nodes', (done) => {
            testContext(async (g, resolve, reject) => {
                const multicastUdpAddress = 'mock-multicast-udp-address-2'
                const daemonOpts = {
                    bootstrapAddresses: [],
                    isBootstrap: false,
                    channelNames: [mockChannelName],
                    multicastUdpAddress,
                    udpListenPort: 'x', // random below
                    webSocketListenPort: null,
                    services: {
                        multicast: true
                    }
                }
                const daemon1 = await g.createDaemon({...daemonOpts, udpListenPort: randomMockPort()})
                const daemon2 = await g.createDaemon({...daemonOpts, udpListenPort: randomMockPort()})

                // // wait a bit
                await sleepMsec(50)

                await testFindFile(daemon1, daemon2)
                // await testLoadFile(daemon1, daemon2)
                await testSubfeedMessage(daemon1, daemon2)
                await testSubmitSubfeedMessage(daemon1, daemon2)

                resolve()
            }, done)
        })
    })
    describe('Test proxy connections', () => {
        it('Create two nodes communicating through proxy server', (done) => {
            testContext(async (g, resolve, reject) => {
                const bootstrapOpts = {
                    bootstrapAddresses: [],
                    isBootstrap: true,
                    channelNames: [],
                    multicastUdpAddress: null,
                    udpListenPort: null,
                    webSocketListenPort: randomMockPort(),
                    services: {
                    }
                }
                const daemonOpts = {
                    bootstrapAddresses: [],
                    isBootstrap: false,
                    channelNames: [mockChannelName],
                    multicastUdpAddress: null,
                    udpListenPort: null,
                    webSocketListenPort: null,
                    services: {
                        announce: true,
                        discover: true,
                        bootstrap: true,
                        proxyClient: true
                    }
                }
                const bootstrapDaemon = await g.createDaemon({...bootstrapOpts})
                const daemon1 = await g.createDaemon({...daemonOpts, bootstrapAddresses: [bootstrapDaemon.address()]})
                const daemon2 = await g.createDaemon({...daemonOpts, bootstrapAddresses: [bootstrapDaemon.address()]})

                // // we expect to have no remote nodes yet
                expect(daemon1.remoteNodeManager().getAllRemoteNodes().length).equals(0)
                expect(daemon2.remoteNodeManager().getAllRemoteNodes().length).equals(0)

                // // wait a bit
                await sleepMsec(50)

                // // we expect to have one remote node now
                expect(daemon1.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).equals(1)
                expect(daemon2.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).equals(1)

                await testFindFile(daemon1, daemon2)
                await testLoadFile(daemon1, daemon2)
                await testSubfeedMessage(daemon1, daemon2)

                resolve()
            }, done)
        })
    })
    // describe('Test udp connections', () => {
    //     it('Create two nodes communicating through udp', (done) => {
    //         testContext(async (g, resolve, reject) => {
    //             const bootstrapDaemon = await g.createDaemon({bootstrapAddresses: [], isBootstrap: true, channelNames: [], multicastUdpAddress: null, udpListenPort: null, webSocketListenPort: randomMockPort()})
    //             const daemon1 = await g.createDaemon({bootstrapAddresses: [bootstrapDaemon.address()], isBootstrap: false, channelNames: [mockChannelName], multicastUdpAddress: null, udpListenPort: null, webSocketListenPort: null})
    //             const daemon2 = await g.createDaemon({bootstrapAddresses: [bootstrapDaemon.address()], isBootstrap: false, channelNames: [mockChannelName], multicastUdpAddress: null, udpListenPort: null, webSocketListenPort: null})
    //             // // we expect to have no remote nodes yet
    //             expect(daemon1.remoteNodeManager().getAllRemoteNodes().length).equals(0)
    //             expect(daemon2.remoteNodeManager().getAllRemoteNodes().length).equals(0)

    //             // // wait a bit
    //             await sleepMsec(50)

    //             // // we expect to have one remote node now
    //             expect(daemon1.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).equals(1)
    //             expect(daemon2.remoteNodeManager().getRemoteNodesInChannel(mockChannelName).length).equals(1)

    //             await testFindFile(daemon1, daemon2)
    //             await testLoadFile(daemon1, daemon2, byteCount(30000), byteCount(2010))
    //             await testSubfeedMessage(daemon1, daemon2)

    //             resolve()
    //         }, done)
    //     })
    // })
 })

const testFindFile = async (daemon1: MockNodeDaemon, daemon2: MockNodeDaemon) => {
    const f1Content = Buffer.from('123456')
    const f1Key = daemon1.mockKacheryStorageManager().addMockFile(f1Content, {chunkSize: byteCount(1000)})

    let numFound = 0
    const a = await daemon2.mockDaemonPostFindFile({
        fileKey: f1Key,
        timeoutMsec: durationMsec(100),
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

const testSubfeedMessage = async (daemon1: MockNodeDaemon, daemon2: MockNodeDaemon) => {
    const fm1 = daemon1.feedManager()
    const fm2 = daemon2.feedManager()

    const feed1 = await fm1.createFeed({feedName: 'f1' as any as FeedName})
    const sf1 = '0123456789012345678901234567890123456789' as any as SubfeedHash
    await fm1.appendMessages({feedId: feed1, subfeedHash: sf1, messages: [{test: 42} as any as SubfeedMessage]})
    const messages = await fm1.getMessages({feedId: feed1, subfeedHash: sf1, position: subfeedPosition(0), maxNumMessages: messageCount(10), waitMsec: durationMsec(1000)})
    expect(messages.length).equals(1)
    expect(messages[0].test).equals(42)

    const messages2 = await fm2.getMessages({feedId: feed1, subfeedHash: sf1, position: subfeedPosition(0), maxNumMessages: messageCount(10), waitMsec: durationMsec(1000)})
    expect(messages2.length).equals(1)
    expect(messages2[0].test).equals(42)

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
    fm1.setAccessRules({feedId: feed1, subfeedHash: sf1, accessRules: accessRules})
    await fm2.submitMessage({feedId: feed1, subfeedHash: sf1, message: {test: 42} as any as SubmittedSubfeedMessage, timeoutMsec: durationMsec(1000)})
    const messages = await fm1.getMessages({feedId: feed1, subfeedHash: sf1, position: subfeedPosition(0), maxNumMessages: messageCount(10), waitMsec: durationMsec(1000)})
    expect(messages.length).equals(1)
    expect(messages[0].test).equals(42)
}

let lastMockPort = 0
const randomMockPort = () => {
    lastMockPort ++
    return toPort(lastMockPort)
}