import { FeedId, FeedName, FeedsConfigRAM, PrivateKeyHex, SignedSubfeedMessage, SubfeedAccessRules, SubfeedHash } from '../../interfaces/core';

export default class MockLocalFeedManager {
    constructor() {
    }
    async createFeed(feedName: FeedName | null): Promise<FeedId> {
        throw Error('not-implemented')
    }
    async deleteFeed(feedId: FeedId): Promise<void> {
        throw Error('not-implemented')
    }
    async getFeedId(feedName: FeedName): Promise<FeedId | null> {
        throw Error('not-implemented')
    }
    async hasWriteableFeed(feedId: FeedId): Promise<boolean> {
        throw Error('not-implemented')
    }
    async getPrivateKeyForFeed(feedId: FeedId): Promise<PrivateKeyHex | null> {
        throw Error('not-implemented')
    }
    feedExistsLocally(feedId: FeedId): boolean {
        throw Error('not-implemented')
    }
    async readSignedSubfeedMessages(feedId: FeedId, subfeedHash: SubfeedHash): Promise<SignedSubfeedMessage[]> {
        throw Error('not-implemented')
    }
    async readSubfeedAccessRules(feedId: FeedId, subfeedHash: SubfeedHash): Promise<SubfeedAccessRules> {
        throw Error('not-implemented')
    }
    appendSignedMessagesToSubfeed(feedId: FeedId, subfeedHash: SubfeedHash, messages: SignedSubfeedMessage[]) {
        throw Error('not-implemented')
    }
    async setSubfeedAccessRules(feedId: FeedId, subfeedHash: SubfeedHash, accessRules: SubfeedAccessRules): Promise<void> {
        throw Error('not-implemented')
    }
    async _loadFeedsConfig(): Promise<FeedsConfigRAM> {
        throw Error('not-implemented')
    }
    async _saveFeedsConfig(config: FeedsConfigRAM) {
        throw Error('not-implemented')
    }
}