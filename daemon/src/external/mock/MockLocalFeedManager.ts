import { createKeyPair, publicKeyHexToFeedId, publicKeyToHex } from '../../common/crypto_util';
import { FeedId, FeedName, PrivateKey, SignedSubfeedMessage, SubfeedAccessRules, SubfeedHash } from '../../interfaces/core';

export default class MockLocalFeedManager {
    #feeds = new Map<FeedId, MockFeed>()
    #feedIdsByFeedName = new Map<FeedName, FeedId>()
    constructor() {
    }
    async createFeed(feedName: FeedName | null): Promise<FeedId> {
        const f = new MockFeed(null)
        this.#feeds.set(f.feedId(), f)
        if (feedName !== null) {
            this.#feedIdsByFeedName.set(feedName, f.feedId())
        }
        return f.feedId()
    }
    async deleteFeed(feedId: FeedId): Promise<void> {
        this.#feeds.delete(feedId)
    }
    async getFeedId(feedName: FeedName): Promise<FeedId | null> {
        return this.#feedIdsByFeedName.get(feedName) || null
    }
    async hasWriteableFeed(feedId: FeedId): Promise<boolean> {
        const f = this.#feeds.get(feedId)
        if (!f) return false
        return f.isWriteable()
    }
    async getPrivateKeyForFeed(feedId: FeedId): Promise<PrivateKey | null> {
        const f = this.#feeds.get(feedId)
        if (!f) return null
        const k = f.privateKey()
        if (!k) return null
        return k
    }
    feedExistsLocally(feedId: FeedId): boolean {
        return this.#feeds.has(feedId)
    }
    async getSignedSubfeedMessages(feedId: FeedId, subfeedHash: SubfeedHash): Promise<SignedSubfeedMessage[]> {
        const f = this.#feeds.get(feedId)
        if (!f) return []
        return await f.getSignedSubfeedMessages(subfeedHash)
    }
    async getSubfeedAccessRules(feedId: FeedId, subfeedHash: SubfeedHash): Promise<SubfeedAccessRules | null> {
        const f = this.#feeds.get(feedId)
        if (!f) return null
        return await f.getSubfeedAccessRules(subfeedHash)
    }
    appendSignedMessagesToSubfeed(feedId: FeedId, subfeedHash: SubfeedHash, messages: SignedSubfeedMessage[]) {
        let f = this.#feeds.get(feedId)
        if (!f) {
            f = new MockFeed(feedId)
            this.#feeds.set(feedId, f)
        }
        f.appendSignedMessagesToSubfeed(subfeedHash, messages)
    }
    setSubfeedAccessRules(feedId: FeedId, subfeedHash: SubfeedHash, accessRules: SubfeedAccessRules): void {
        const f = this.#feeds.get(feedId)
        if (!f) {
            throw Error('No feed')
        }
        if (!f.isWriteable()) {
            throw Error('Not writeable')
        }
        f.setSubfeedAccessRules(subfeedHash, accessRules)
    }
}

class MockFeed {
    #feedId: FeedId
    #privateKey: PrivateKey | null = null
    #subfeeds = new Map<SubfeedHash, MockSubfeed>()
    constructor(feedId: FeedId | null) {
        if (feedId !== null) {
            this.#feedId = feedId
        }
        else {
            const {publicKey, privateKey} = createKeyPair()
            this.#privateKey = privateKey
            this.#feedId = publicKeyHexToFeedId(publicKeyToHex(publicKey))
        }
    }
    feedId(): FeedId {
        return this.#feedId
    }
    isWriteable(): boolean {
        return this.#privateKey !== null
    }
    privateKey(): PrivateKey | null {
        return this.#privateKey
    }
    async getSignedSubfeedMessages(subfeedHash: SubfeedHash): Promise<SignedSubfeedMessage[]> {
        const s = this.#subfeeds.get(subfeedHash)
        if (!s) return []
        return await s.getSignedSubfeedMessages()
    }
    async getSubfeedAccessRules(subfeedHash: SubfeedHash): Promise<SubfeedAccessRules | null> {
        const s = this.#subfeeds.get(subfeedHash)
        if (!s) return null
        return await s.getSubfeedAccessRules()
    }
    appendSignedMessagesToSubfeed(subfeedHash: SubfeedHash, messages: SignedSubfeedMessage[]) {
        let s = this.#subfeeds.get(subfeedHash)
        if (!s) {
            s = new MockSubfeed()
            this.#subfeeds.set(subfeedHash, s)
        }
        s.appendSignedMessagesToSubfeed(messages)
    }
    setSubfeedAccessRules(subfeedHash: SubfeedHash, accessRules: SubfeedAccessRules): void {
        let s = this.#subfeeds.get(subfeedHash)
        if (!s) {
            s = new MockSubfeed()
            this.#subfeeds.set(subfeedHash, s)
        }
        s.setSubfeedAccessRules(accessRules)
    }
}

class MockSubfeed {
    #signedSubfeedMessages: SignedSubfeedMessage[] = []
    #subfeedAccessRules: SubfeedAccessRules | null = null
    constructor() {
    }
    async getSignedSubfeedMessages(): Promise<SignedSubfeedMessage[]> {
        return this.#signedSubfeedMessages
    }
    async getSubfeedAccessRules(): Promise<SubfeedAccessRules | null> {
        return this.#subfeedAccessRules
    }
    appendSignedMessagesToSubfeed(messages: SignedSubfeedMessage[]) {
        this.#signedSubfeedMessages = [...this.#signedSubfeedMessages, ...messages]
    }
    setSubfeedAccessRules(accessRules: SubfeedAccessRules): void {
        this.#subfeedAccessRules = accessRules
    }
}