import { expect } from 'chai';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import * as mocha from 'mocha'; // import types for mocha e.g. describe
import os from 'os';
import { getSignature, hexToPublicKey, JSONStringifyDeterministic } from '../../src/common/crypto_util';
import { randomAlphaString } from '../../src/common/util';
import ExternalInterface from '../../src/external/ExternalInterface';
import realExternalInterface from '../../src/external/real/realExternalInterface';
import { Address, byteCount, feedIdToPublicKeyHex, FeedName, FileKey, hostName, localFilePath, NodeId, nowTimestamp, Sha1Hash, SignedSubfeedMessage, SubfeedAccessRules, SubfeedHash, SubfeedMessage, toPort, unscaledDurationMsec, urlPath } from '../../src/interfaces/core';

const testContext = (testFunction: (externalInterface: ExternalInterface, resolve: () => void, reject: (err: Error) => void) => Promise<void>, done: (err?: Error) => void) => {
    const tempPath = `${os.tmpdir()}/kachery-p2p-test-${randomAlphaString(10)}.tmp`
    fs.mkdirSync(tempPath.toString())
    const resolve = () => {
        fs.rmdirSync(tempPath, {recursive: true})
        done()
    }
    const reject = (err: Error) => {
        fs.rmdirSync(tempPath, {recursive: true})
        done(err)
    }
    
    const ri = realExternalInterface(localFilePath(tempPath), localFilePath(tempPath + '/config'))

    testFunction(ri, resolve, reject).then(() => {
    }).catch((err: Error) => {
        reject(err)
    })
}

// need to explicitly use mocha prefix once or the dependency gets wrongly cleaned up
mocha.describe('Real external interface', () => {
    describe('http requests', () => {
        it('httpPostJson', (done) => {
            testContext(async (ri, resolve, reject) => {
                const port = toPort(8059)

                const app = express()
                app.set('json spaces', 4)
                app.use(express.json())
                app.post('/test', async (req, res) => {
                    res.json({echo: req.body})
                });
                const server = await ri.startHttpServer(app, port)
                const address: Address = {hostName: hostName('localhost'), port}
                const req = {test: 3}
                const resp = await ri.httpPostJson(address, urlPath('/test'), req, {timeoutMsec: unscaledDurationMsec(500)})
                expect(JSONStringifyDeterministic(resp)).equals(JSONStringifyDeterministic({echo: req}))
                server.close()
                resolve()
            }, done)
        })
        it('httpGetDownload', (done) => {
            testContext(async (ri, resolve, reject) => {
                const port = toPort(8060)

                const data = Buffer.alloc(1000 * 20, 'b')

                const app = express()
                app.get('/test', async (req, res) => {
                    res.write(data.slice(0, 1000))
                    setTimeout(() => {
                        res.write(data.slice(1000, data.length))
                        res.end()
                    }, 5)
                });
                const server = await ri.startHttpServer(app, port)
                const address: Address = {hostName: hostName('localhost'), port}
                const ds = await ri.httpGetDownload(address, urlPath('/test'))
                const chunks: Buffer[] = []
                ds.onData(chunk => {
                    chunks.push(chunk)
                })
                ds.onFinished(() => {
                    const b = Buffer.concat(chunks)
                    expect(b.length).equals(data.length)
                    server.close()
                    resolve()
                })
                ds.onError((err: Error) => {
                    server.close()
                    reject(err)
                })
            }, done)
        })
    })
    describe('web sockets', () => {
        it('webSocket', (done) => {
            testContext(async (ri, resolve, reject) => {
                const port = toPort(8061)

                const wss = await ri.startWebSocketServer(port, '' as any as NodeId)
                wss.onConnection(ws1 => {
                    ws1.onMessage(buf => {
                        expect(buf.length).equals(3)
                        ws1.send(Buffer.from('abcde'))
                    })
                })

                const url = `ws://localhost:${port}`
                const ws = ri.createWebSocket(url, {timeoutMsec: unscaledDurationMsec(1000)})

                ws.onOpen(() => {
                    ws.send(Buffer.from('abc'))
                })
                ws.onMessage((msg) => {
                    expect(msg.length).equals(5)
                    ws.close()
                    setTimeout(() => {
                        wss.close()
                        resolve()
                    }, 3)
                })
            }, done)
        })
    })
    describe('local feed manager', () => {
        it('localFeedManager', (done) => {
            testContext(async (ri, resolve, reject) => {
                const fm = ri.createLocalFeedManager()
                const feedId = await fm.createFeed('testFeedName' as any as FeedName)
                expect(await fm.getFeedId('testFeedName' as any as FeedName)).equals(feedId.toString())
                expect(await fm.hasWriteableFeed(feedId)).is.true
                const privateKey = await fm.getPrivateKeyForFeed(feedId)
                if (!privateKey) {
                    throw Error('No private key')
                }
                expect(fm.feedExistsLocally(feedId)).is.true
                const subfeedHash = '0123456789012345678901234567890123456789' as any as SubfeedHash
                const msgBody = {
                    messageNumber: 0,
                    message: {test: 1} as any as SubfeedMessage,
                    timestamp: nowTimestamp()
                }
                const msg0: SignedSubfeedMessage = {
                    body: msgBody,
                    signature: getSignature(msgBody, {publicKey: hexToPublicKey(feedIdToPublicKeyHex(feedId)), privateKey})
                }
                fm.appendSignedMessagesToSubfeed(feedId, subfeedHash, [msg0])
                const messages = await fm.getSignedSubfeedMessages(feedId, subfeedHash)
                expect(messages.length).equals(1)
                const accessRules: SubfeedAccessRules = {
                    rules: []
                }
                fm.setSubfeedAccessRules(feedId, subfeedHash, accessRules)
                const ar2 = await fm.getSubfeedAccessRules(feedId, subfeedHash)
                if (!ar2) {
                    throw Error('No access rules')
                }
                expect(JSONStringifyDeterministic(accessRules)).equals(JSONStringifyDeterministic(ar2))
                await fm.deleteFeed(feedId)
                resolve()
            }, done)
        })
    })
    describe('local kachery', () => {
        it('localKacheryStorage', (done) => {
            testContext(async (ri, resolve, reject) => {
                const ksm = ri.createKacheryStorageManager()

                const buf = Buffer.alloc(104, 'c')
                const shasum = crypto.createHash('sha1')
                shasum.update(buf)
                const sha1 = shasum.digest('hex') as any as Sha1Hash
                await ksm.storeFile(sha1, buf)
                const r = await ksm.findFile({sha1})
                expect(r.found).is.true

                const block = buf.slice(0, 50)
                const blockShasum = crypto.createHash('sha1')
                blockShasum.update(block)
                const blockSha1 = blockShasum.digest('hex') as any as Sha1Hash
                const blockKey: FileKey = {
                    sha1: blockSha1,
                    chunkOf: {
                        fileKey: {sha1},
                        startByte: byteCount(0),
                        endByte: byteCount(50)
                    }
                }

                const rBlock = await ksm.findFile(blockKey)
                expect(rBlock.found).is.true

                const chunks: Buffer[] = []
                const ds = await ksm.getFileReadStream(blockKey)
                ds.onData((d: Buffer) => {
                    chunks.push(d)
                })
                ds.onError(err => {
                    reject(err)
                })
                ds.onFinished(() => {
                    const buf2 = Buffer.concat(chunks)
                    expect(buf2.length).equals(block.length)
                    resolve()
                })
            }, done)
        })
    })
})