import { expect } from 'chai';
import * as mocha from 'mocha'; // import types for mocha e.g. describe
import { sleepMsec } from '../../src/common/util';
import MockNodeDaemon, { MockNodeDaemonGroup, MockNodeDefects } from '../../src/external/mock/MockNodeDaemon';
import { byteCount, ByteCount, byteCountToNumber, ChannelName, DurationMsec, durationMsecToNumber, FeedId, FeedName, HostName, JSONObject, MessageCount, messageCount, scaledDurationMsec, SubfeedAccessRules, SubfeedHash, SubfeedMessage, SubfeedPosition, subfeedPosition, SubfeedWatches, SubmittedSubfeedMessage, toPort } from '../../src/interfaces/core';
import { ApiLoadFileRequest, FeedApiAppendMessagesRequest, FeedApiCreateFeedRequest, FeedApiDeleteFeedRequest, FeedApiGetAccessRulesRequest, FeedApiGetFeedIdRequest, FeedApiGetFeedInfoRequest, FeedApiGetMessagesRequest, FeedApiGetNumMessagesRequest, FeedApiGetSignedMessagesRequest, FeedApiSetAccessRulesRequest, FeedApiSubmitMessageRequest, FeedApiWatchForNewMessagesRequest, isFeedApiAppendMessagesResponse, isFeedApiCreateFeedResponse, isFeedApiDeleteFeedResponse, isFeedApiGetAccessRulesResponse, isFeedApiGetFeedIdResponse, isFeedApiGetFeedInfoResponse, isFeedApiGetMessagesResponse, isFeedApiGetNumMessagesResponse, isFeedApiGetSignedMessagesResponse, isFeedApiSetAccessRulesResponse, isFeedApiSubmitMessageResponse, isFeedApiWatchForNewMessagesResponse } from '../../src/services/DaemonApiServer';
import { StartDaemonOpts } from '../../src/startDaemon';

const mockChannelName = 'mock-channel' as any as ChannelName
const mockChannelName2 = 'mock-channel-2' as any as ChannelName

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
                        display: true
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
                        display: true
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
        //                 display: false
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
        //                 bootstrap: true,
        //                 display: false
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
                const multicastUdpAddress = {hostName: 'local-mock-multicast-udp-address-1' as any as HostName, port: toPort(21010)}
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
                        udpSocket: true,
                        display: false
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
                    channelNames: [mockChannelName2],
                    multicastUdpAddress: null,
                    udpSocketPort: null,
                    webSocketListenPort: randomMockPort(),
                    firewalled: false,
                    services: {
                        webSocketServer: true,
                        display: false
                    }
                }
                const daemonOpts: StartDaemonOpts = {
                    bootstrapAddresses: [],
                    isBootstrap: false,
                    channelNames: [mockChannelName, mockChannelName2],
                    multicastUdpAddress: null,
                    udpSocketPort: null,
                    webSocketListenPort: null,
                    firewalled: true,
                    services: {
                        announce: true,
                        discover: true,
                        bootstrap: true,
                        proxyClient: true,
                        display: false
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
                await testLoadFile(daemon1, daemon2, byteCount(21000), byteCount(12000))
                await testLoadFile(bootstrapDaemon, daemon1, byteCount(20000), byteCount(12000))
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
                        webSocketServer: true,
                        display: false
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
                        proxyClient: true,
                        display: false
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
                        webSocketServer: true,
                        display: false
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
                        proxyClient: true,
                        display: false
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

    const reqData: ApiLoadFileRequest = {
        fileKey: f1Key,
        fromChannel: null,
        fromNode: null
    }
    const x = await daemon2.mockDaemonApiServer().mockPostLoadFile(reqData as any as JSONObject)
    await new Promise((resolve, reject) => {
        x.onError(err => {
            reject(err)
        })
        x.onFinished(() => {
            resolve()
        })
    })
    const f = await daemon2.mockKacheryStorageManager().findFile(f1Key)
    expect(f.found).is.true

    daemon1.node().getStats({format: 'html'}) // for coverage
    const stats1 = daemon1.node().getStats({format: 'json'})
    const stats2 = daemon1.node().getStats({format: 'json'})
    expect(byteCountToNumber(stats1.totalBytesSent.total)).is.gte(byteCountToNumber(fileSize))
    expect(byteCountToNumber(stats2.totalBytesReceived.total)).is.gte(byteCountToNumber(fileSize))
}

const testLoadFileWithDefects = async (daemon1: MockNodeDaemon, daemon2: MockNodeDaemon, fileSize: ByteCount = byteCount(20000), chunkSize: ByteCount = byteCount(1200)) => {
    const f1Content = Buffer.alloc(byteCountToNumber(fileSize), 'c')
    const f2Content = Buffer.alloc(byteCountToNumber(fileSize), 'd')

    daemon1.setDefects({
        fileReadDefect: true
    })

    const f1Key = daemon1.mockKacheryStorageManager().addMockFile(f1Content, {chunkSize})
    const f2Key = daemon1.mockKacheryStorageManager().addMockFile(f2Content, {chunkSize})

    {
        const reqData: ApiLoadFileRequest = {
            fileKey: f1Key,
            fromChannel: null,
            fromNode: null
        }
        const x = await daemon2.mockDaemonApiServer().mockPostLoadFile(reqData as any as JSONObject)
        try {
            await new Promise((resolve, reject) => {
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
    }

    {
        daemon1.clearDefects()
        daemon2.setDefects({
            badDownloadFileDataRequest: true
        })

        const reqData: ApiLoadFileRequest = {
            fileKey: f2Key,
            fromChannel: null,
            fromNode: null
        }
        const x = await daemon2.mockDaemonApiServer().mockPostLoadFile(reqData as any as JSONObject)
        try {
            await new Promise((resolve, reject) => {
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
            if (!err.message.startsWith('Unable to stream file data')) {
                throw err
            }
        }
    }

    daemon1.clearDefects()
    daemon2.clearDefects()
}

const createFeed = async (daemon: MockNodeDaemon, feedName: FeedName) => {
    const req: FeedApiCreateFeedRequest = {feedName}
    const res = await daemon.mockDaemonApiPost('/feed/createFeed', req as any as JSONObject)
    if (!isFeedApiCreateFeedResponse(res)) throw Error('Unexpected')
    return res.feedId
}

const deleteFeed = async (daemon: MockNodeDaemon, feedId: FeedId) => {
    const req: FeedApiDeleteFeedRequest = {feedId}
    const res = await daemon.mockDaemonApiPost('/feed/deleteFeed', req as any as JSONObject)
    if (!isFeedApiDeleteFeedResponse(res)) throw Error('Unexpected')
    return res.success
}

const appendMessages = async (daemon: MockNodeDaemon, feedId: FeedId, subfeedHash: SubfeedHash, messages: SubfeedMessage[]) => {
    const req: FeedApiAppendMessagesRequest = {
        feedId, subfeedHash, messages
    }
    const res = await daemon.mockDaemonApiPost('/feed/appendMessages', req as any as JSONObject)
    if (!isFeedApiAppendMessagesResponse(res)) throw Error('Unexpected')
    return res.success
}

const submitMessage = async (daemon: MockNodeDaemon, feedId: FeedId, subfeedHash: SubfeedHash, message: SubmittedSubfeedMessage, timeoutMsec: DurationMsec) => {
    const req: FeedApiSubmitMessageRequest = {
        feedId, subfeedHash, message, timeoutMsec
    }
    const res = await daemon.mockDaemonApiPost('/feed/submitMessage', req as any as JSONObject)
    if (!isFeedApiSubmitMessageResponse(res)) throw Error('Unexpected')
    return res.success
}

const getMessages = async (daemon: MockNodeDaemon, feedId: FeedId, subfeedHash: SubfeedHash, position: SubfeedPosition, maxNumMessages: MessageCount, waitMsec: DurationMsec) => {
    const req: FeedApiGetMessagesRequest = {
        feedId, subfeedHash, position, maxNumMessages, waitMsec
    }
    const res = await daemon.mockDaemonApiPost('/feed/getMessages', req as any as JSONObject)
    if (!isFeedApiGetMessagesResponse(res)) throw Error('Unexpected')
    if (!res.success) throw Error('Error getting messages')
    return res.messages
}
const getSignedMessages = async (daemon: MockNodeDaemon, feedId: FeedId, subfeedHash: SubfeedHash, position: SubfeedPosition, maxNumMessages: MessageCount, waitMsec: DurationMsec) => {
    const req: FeedApiGetSignedMessagesRequest = {
        feedId, subfeedHash, position, maxNumMessages, waitMsec
    }
    const res = await daemon.mockDaemonApiPost('/feed/getSignedMessages', req as any as JSONObject)
    if (!isFeedApiGetSignedMessagesResponse(res)) throw Error('Unexpected')
    if (!res.success) throw Error('Error getting signed messages')
    return res.signedMessages
}

const getNumMessages = async (daemon: MockNodeDaemon, feedId: FeedId, subfeedHash: SubfeedHash) => {
    const req: FeedApiGetNumMessagesRequest = {
        feedId, subfeedHash
    }
    const res = await daemon.mockDaemonApiPost('/feed/getNumMessages', req as any as JSONObject)
    if (!isFeedApiGetNumMessagesResponse(res)) throw Error('Unexpected')
    if (!res.success) throw Error('Error getting messages')
    return res.numMessages
}

const getFeedInfo = async (daemon: MockNodeDaemon, feedId: FeedId, timeoutMsec: DurationMsec) => {
    const req: FeedApiGetFeedInfoRequest = {
        feedId, timeoutMsec
    }
    const res = await daemon.mockDaemonApiPost('/feed/getFeedInfo', req as any as JSONObject)
    if (!isFeedApiGetFeedInfoResponse(res)) {
        console.warn(res)
        throw Error('Unexpected')
    }
    if (!res.success) throw Error('Error getting live feed info')
    return res
}

const getAccessRules = async (daemon: MockNodeDaemon, feedId: FeedId, subfeedHash: SubfeedHash) => {
    const req: FeedApiGetAccessRulesRequest = {
        feedId, subfeedHash
    }
    const res = await daemon.mockDaemonApiPost('/feed/getAccessRules', req as any as JSONObject)
    if (!isFeedApiGetAccessRulesResponse(res)) throw Error('Unexpected')
    if (!res.success) throw Error('Error getting access rules')
    return res.accessRules
}

const setAccessRules = async (daemon: MockNodeDaemon, feedId: FeedId, subfeedHash: SubfeedHash, accessRules: SubfeedAccessRules) => {
    const req: FeedApiSetAccessRulesRequest = {
        feedId, subfeedHash, accessRules
    }
    const res = await daemon.mockDaemonApiPost('/feed/setAccessRules', req as any as JSONObject)
    if (!isFeedApiSetAccessRulesResponse(res)) throw Error('Unexpected')
    if (!res.success) throw Error('Error setting access rules')
    return
}

const watchForNewMessages = async (daemon: MockNodeDaemon, subfeedWatches: SubfeedWatches, waitMsec: DurationMsec, maxNumMessages: MessageCount) => {
    const req: FeedApiWatchForNewMessagesRequest = {
        subfeedWatches,
        waitMsec,
        maxNumMessages
    }
    const res = await daemon.mockDaemonApiPost('/feed/watchForNewMessages', req as any as JSONObject)
    if (!isFeedApiWatchForNewMessagesResponse(res)) throw Error('Unexpected')
    if (!res.success) throw Error('Problem watching for new messages')
    return res.messages
}

const getFeedId = async (daemon: MockNodeDaemon, feedName: FeedName) => {
    const req: FeedApiGetFeedIdRequest = {
        feedName
    }
    const res = await daemon.mockDaemonApiPost('/feed/getFeedId', req as any as JSONObject)
    if (!isFeedApiGetFeedIdResponse(res)) throw Error('Unexpected')
    return res.feedId
}

const testSubfeedMessage = async (daemon1: MockNodeDaemon, daemon2: MockNodeDaemon) => {
    const feed1 = await createFeed(daemon1, 'f1' as any as FeedName)
    const sf1 = '0123456789012345678901234567890123456789' as any as SubfeedHash
    await appendMessages(daemon1, feed1, sf1, [{test: 42} as any as SubfeedMessage])
    await submitMessage(daemon1, feed1, sf1, {test: 420} as any as SubmittedSubfeedMessage, scaledDurationMsec(5000))
    const messages = await getMessages(daemon1, feed1, sf1, subfeedPosition(0), messageCount(10), scaledDurationMsec(3000))
    const signedMessages = await getSignedMessages(daemon1, feed1, sf1, subfeedPosition(0), messageCount(10), scaledDurationMsec(3000))
    expect(messages.length).equals(2)
    expect(signedMessages.length).equals(2)
    expect(messages[0].test).equals(42)

    // do this first line so that we can test the simultaneous loading of the same subfeed (code coverage)
    const p1 = getMessages(daemon2, feed1, sf1, subfeedPosition(0), messageCount(10), scaledDurationMsec(5000))
    const messages2 = await getMessages(daemon2, feed1, sf1, subfeedPosition(0), messageCount(10), scaledDurationMsec(5000))
    const messages2b = await p1
    expect(messages2.length).equals(2)
    expect(messages2b.length).equals(2)
    expect(messages2[0].test).equals(42)
    expect(await getNumMessages(daemon2, feed1, sf1)).to.equal(2)

    const fi = await getFeedInfo(daemon2, feed1, scaledDurationMsec(5000))
    expect(fi.nodeId).equals(daemon1.nodeId())
    const fi2 = await getFeedInfo(daemon1, feed1, scaledDurationMsec(5000))
    expect(fi2.nodeId).equals(daemon1.nodeId())

    try {
        await appendMessages(daemon2, feed1, sf1, [{test: 43} as any as SubfeedMessage])
        throw Error('Did not get expected error')
    }
    catch(err) {
        if (!err.message.includes('Subfeed is not writeable')) {
            throw(err)
        }
    }

    const reqData: FeedApiGetMessagesRequest = {
        feedId: feed1,
        subfeedHash: sf1,
        position: subfeedPosition(2),
        maxNumMessages: messageCount(10),
        waitMsec: scaledDurationMsec(10000)
    }
    setTimeout(() => {
        appendMessages(daemon1, feed1, sf1, [{m: 1} as any as SubfeedMessage, {m: 2} as any as SubfeedMessage])
    }, durationMsecToNumber(scaledDurationMsec(3000)))
    const response = await daemon2.mockDaemonApiPost('/feed/getMessages', reqData as any as JSONObject)
    if (!isFeedApiGetMessagesResponse(response)) {
        throw Error('Unexpected')
    }
    expect(response.messages.length).equals(2)

    // expect(await fm1.hasWriteableFeed({feedId: feed1})).is.true
    const feed1b = await getFeedId(daemon1, 'f1' as any as FeedName)
    expect(feed1b).equals(feed1)

    const watchReq: FeedApiWatchForNewMessagesRequest = {
        subfeedWatches: {
            'w1': {
                feedId: feed1,
                subfeedHash: sf1,
                position: subfeedPosition(4)
            }
        },
        waitMsec: scaledDurationMsec(10000),
        maxNumMessages: messageCount(10)
    }
    setTimeout(() => {
        appendMessages(daemon1, feed1, sf1, [{m: 3} as any as SubfeedMessage, {m: 4} as any as SubfeedMessage])
    }, durationMsecToNumber(scaledDurationMsec(3000)))
    const response2 = await daemon2.mockDaemonApiPost('/feed/watchForNewMessages', watchReq as any as JSONObject)
    if (!isFeedApiWatchForNewMessagesResponse(response2)) {
        throw Error('Unexpected')
    }
    const w1 = response2.messages.w1 as any as []
    expect(w1.length).equals(2)

    await deleteFeed(daemon1, feed1)
    // expect(await fm1.hasWriteableFeed({feedId: feed1})).is.false
}

const testSubmitSubfeedMessage = async (daemon1: MockNodeDaemon, daemon2: MockNodeDaemon) => {
    const feed1 = await createFeed(daemon1, 'f1' as any as FeedName)
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
        await submitMessage(daemon2, feed1, sf1, {test: 41} as any as SubmittedSubfeedMessage, scaledDurationMsec(1000))
        throw Error('Did not get submit message permission denied error')
    }
    catch(err) {       
        if (!err.message.includes('Error submitting message to remote live feed: Permission denied')) { 
            throw Error(err)
        }
    }
    await setAccessRules(daemon1, feed1, sf1, accessRules)
    await submitMessage(daemon2, feed1, sf1, {test: 42} as any as SubmittedSubfeedMessage, scaledDurationMsec(1000))
    const messages = await getMessages(daemon1, feed1, sf1, subfeedPosition(0), messageCount(10), scaledDurationMsec(1000))
    expect(messages.length).equals(1)
    expect(messages[0].test).equals(42)

    const ar1 = await getAccessRules(daemon1, feed1, sf1)
    if (!ar1) {
        throw(Error('Unable to get access rules'))
    }
    expect(ar1.rules.length).equals(1)
    try {
        const ar2 = await getAccessRules(daemon2, feed1, sf1)
        throw Error('Did not get expected error')
    }
    catch(err) {
        if (!err.message.includes('Cannot get access rules for subfeed that is not writeable')) {
            throw(err)
        }
    }

    try {
        await setAccessRules(daemon2, feed1, sf1, ar1)
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