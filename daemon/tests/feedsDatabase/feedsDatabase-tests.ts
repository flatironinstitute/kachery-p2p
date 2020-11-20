import { expect } from 'chai';
import fs from 'fs';
import * as mocha from 'mocha'; // import types for mocha e.g. describe
import os from 'os';
import { createKeyPair, publicKeyHexToFeedId, publicKeyToHex } from '../../src/common/crypto_util';
import { randomAlphaString } from '../../src/common/util';
import LocalFeedsDatabase from '../../src/external/real/LocalFeedsDatabase';
import { isSignature, localFilePath, nowTimestamp, SignedSubfeedMessage, SubfeedAccessRules, SubfeedHash, SubfeedMessage } from '../../src/interfaces/core';

const testContext = (testFunction: (localFeedsDatabase: LocalFeedsDatabase, resolve: () => void, reject: (err: Error) => void) => Promise<void>, done: (err?: Error) => void) => {
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

    const fd = new LocalFeedsDatabase(localFilePath(tempPath + '/feeds.db'))

    testFunction(fd, resolve, reject).then(() => {
    }).catch((err: Error) => {
        reject(err)
    })
}

// need to explicitly use mocha prefix once or the dependency gets wrongly cleaned up
mocha.describe('Feeds database', () => {
    describe('feeds database aaa102', () => {
        it('test feeds database', (done) => {
            testContext(async (db, resolve, reject) => {
                const {publicKey, privateKey} = createKeyPair()
                const feedId = publicKeyHexToFeedId(publicKeyToHex(publicKey))
                await db.addFeed(feedId)
                const has = await db.hasFeed(feedId)
                expect(has).to.be.true
                const subfeedHash = '0123456789012345678901234567890123456789' as any as SubfeedHash
                const validSignature = new Array(129).join('1')
                if (!isSignature(validSignature)) {
                    throw Error('Not valid signature')
                }
                const msg1: SignedSubfeedMessage = {
                    body: {
                        previousSignature: validSignature,
                        messageNumber: 0,
                        message: {example: 1} as any as SubfeedMessage,
                        timestamp: nowTimestamp()
                    },
                    signature: validSignature
                }
                const msg2: SignedSubfeedMessage = {
                    body: {
                        previousSignature: validSignature,
                        messageNumber: 1,
                        message: {example: 1} as any as SubfeedMessage,
                        timestamp: nowTimestamp()
                    },
                    signature: validSignature
                }
                await db.appendSignedMessagesToSubfeed(feedId, subfeedHash, [msg1, msg2])

                const x = await db.getSignedSubfeedMessages(feedId, subfeedHash)
                expect(x.length).equals(2)

                const accessRules: SubfeedAccessRules = {rules: []}
                await db.setSubfeedAccessRules(feedId, subfeedHash, accessRules)

                const ar = await db.getSubfeedAccessRules(feedId, subfeedHash)
                if (!ar) {
                    throw Error('Did not get access rules')
                }
                expect(ar.rules.length).equals(accessRules.rules.length)

                resolve()
            }, done)
        })
    })
})