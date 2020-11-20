import { Mutex } from 'async-mutex';
import { Database, open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { JSONStringifyDeterministic } from '../../common/crypto_util';
import { FeedId, isJSONObject, isSignedSubfeedMessage, isString, isSubfeedAccessRules, LocalFilePath, SignedSubfeedMessage, SubfeedAccessRules, SubfeedHash } from "../../interfaces/core";

class LocalFeedsDatabase {
    #db: Database | null = null
    #mutex = new Mutex()
    constructor(private databasePath: LocalFilePath) {
    }
    async _initialize() {
        const createTables = async (db: Database) => {
            await db.run(`
                CREATE TABLE IF NOT EXISTS feeds (
                    feedId TEXT PRIMARY KEY NOT NULL
                ) WITHOUT ROWID;
            `)
            await db.run(`
                CREATE TABLE IF NOT EXISTS subfeeds (
                    feedId TEXT NOT NULL,
                    subfeedHash TEXT NOT NULL,
                    accessRules TEXT,
                    PRIMARY KEY(feedId, subfeedHash),
                    FOREIGN KEY (feedId)
                    REFERENCES feeds (feedId) 
                        ON UPDATE CASCADE
                        ON DELETE CASCADE
                ) WITHOUT ROWID;
            `)
            await db.run(`
                CREATE TABLE IF NOT EXISTS subfeedMessages (
                    feedId TEXT NOT NULL,
                    subfeedHash TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    message TEXT,
                    PRIMARY KEY(feedId, subfeedHash, position),
                    FOREIGN KEY (feedId, subfeedHash)
                        REFERENCES subfeeds (feedId, subfeedHash) 
                            ON UPDATE CASCADE
                            ON DELETE CASCADE
                ) WITHOUT ROWID;
            `)   
        }
        const db = await open({filename: this.databasePath.toString(), driver: sqlite3.Database})
        await db.run(`PRAGMA foreign_keys = ON`)
        await createTables(db)
        this.#db = db
    }
    async _database(): Promise<Database> {
        if (this.#db) return this.#db
        const release = await this.#mutex.acquire()
        if (this.#db) {
            release()
            return this.#db
        }
        await this._initialize()
        release()
        if (!this.#db) throw Error('Unexpected null database after initialization')
        return this.#db
    }
    async addFeed(feedId: FeedId) {
        const db = await this._database()
        await db.run(`
            INSERT INTO feeds (feedId) VALUES ($feedId)
        `, {
            '$feedId': feedId.toString()
        })
    }
    async deleteFeed(feedId: FeedId) {
        const db = await this._database()
        await db.run(`
            DELETE FROM feeds WHERE feedId = $feedId
        `, {
            '$feedId': feedId.toString()
        })
    }
    async hasFeed(feedId: FeedId): Promise<boolean> {
        const db = await this._database()
        const row = await db.get(`
            SELECT feedId FROM feeds WHERE feedId = $feedId
        `, {
            '$feedId': feedId.toString()
        })
        if (row) {
            if (row.feedId === feedId.toString()) {
                return true
            }
            else {
                throw Error('Unexpected: mismatch in feedId')
            }
        }
        else {
            return false
        }
    }
    async getSignedSubfeedMessages(feedId: FeedId, subfeedHash: SubfeedHash): Promise<SignedSubfeedMessage[]> {
        const db = await this._database()
        const rows: {message: string, position: number}[] = await db.all(`
            SELECT message, position FROM subfeedMessages WHERE feedId = $feedId AND subfeedHash = $subfeedHash ORDER BY position ASC
        `, {
            '$feedId': feedId.toString(),
            '$subfeedHash': subfeedHash.toString()
        })
        if (!rows) {
            throw Error('Unexpected rows undefined')
        }
        const ret: SignedSubfeedMessage[] = []
        for (let i = 0; i < rows.length; i ++) {
            const row = rows[i]
            if (row.position !== i) {
                throw Error(`Unexpected position in signed subfeed message: ${feedId} ${subfeedHash} ${i} <> ${row.position}`)
            }
            let m
            try {
                m = JSON.parse(row.message)
            }
            catch(err) {
                throw err
            }
            if (!isSignedSubfeedMessage(m)) {
                throw Error(`Problem in signed subfeed message from database: ${feedId} ${subfeedHash} ${i}`)
            }
            if (m.body.messageNumber !== i) {
                throw Error(`Unexpected message number in signed subfeed message: ${feedId} ${subfeedHash} ${i} <> ${m.body.messageNumber}`)
            }
            ret.push(m)
        }
        return ret
    }
    async getSubfeedAccessRules(feedId: FeedId, subfeedHash: SubfeedHash): Promise<SubfeedAccessRules | null> {
        const db = await this._database()
        const row = await db.get(`
            SELECT accessRules FROM subfeeds WHERE feedId = $feedId AND subfeedHash = $subfeedHash
        `, {
            '$feedId': feedId.toString(),
            '$subfeedHash': subfeedHash.toString()
        })
        if (row) {
            if (!isJSONObject(row)) {
                throw Error(`Problem getting access rules of subfeed (*): ${feedId} ${subfeedHash}`)
            }
            if (!row.accessRules) return null
            let accessRulesJson = row.accessRules
            if (!isString(accessRulesJson)) {
                throw Error(`Problem getting access rules of subfeed: ${feedId} ${subfeedHash}`)
            }
            let accessRules
            try {
                accessRules = JSON.parse(accessRulesJson)
            }
            catch(err) {
                throw Error(`Problem parsing access rules of subfeed: ${feedId} ${subfeedHash}`)
            }
            if (!isSubfeedAccessRules(accessRules)) {
                throw Error(`Problem in access rules of subfeed: ${feedId} ${subfeedHash}`)
            }
            return accessRules
        }
        else {
            return null
        }
    }
    async setSubfeedAccessRules(feedId: FeedId, subfeedHash: SubfeedHash, accessRules: SubfeedAccessRules): Promise<void> {
        const db = await this._database()
        await this._createFeedRowIfNeeded(feedId)
        await db.run(`
            INSERT OR REPLACE INTO subfeeds (feedId, subfeedHash, accessRules) VALUES ($feedId, $subfeedHash, $accessRules)
        `, {
            '$feedId': feedId.toString(),
            '$subfeedHash': subfeedHash.toString(),
            '$accessRules': JSONStringifyDeterministic(accessRules)
        })
    }
    async appendSignedMessagesToSubfeed(feedId: FeedId, subfeedHash: SubfeedHash, messages: SignedSubfeedMessage[]) {
        const db = await this._database()
        if (messages.length === 0) return
        await this._createSubfeedRowIfNeeded(feedId, subfeedHash)
        const data = messages.map(m => ({
            feedId,
            subfeedHash,
            position: m.body.messageNumber,
            message: JSONStringifyDeterministic(m)
        }))
        for (let d of data) {
            await db.run(`
                INSERT INTO subfeedMessages (feedId, subfeedHash, position, message) VALUES ($feedId, $subfeedHash, $position, $message)
            `, {
                '$feedId': d.feedId,
                '$subfeedHash': d.subfeedHash,
                '$position': d.position,
                '$message': d.message
            })
        }
    }
    async _createFeedRowIfNeeded(feedId: FeedId) {
        const db = await this._database()
        await db.run(`
            INSERT OR IGNORE INTO feeds (feedId) VALUES ($feedId)
        `, {
            '$feedId': feedId.toString()
        })
    }
    async _createSubfeedRowIfNeeded(feedId: FeedId, subfeedHash: SubfeedHash) {
        const db = await this._database()
        await this._createFeedRowIfNeeded(feedId)
        await db.run(`
            INSERT OR IGNORE INTO subfeeds (feedId, subfeedHash) VALUES ($feedId, $subfeedHash)
        `, {
            '$feedId': feedId.toString(),
            '$subfeedHash': subfeedHash.toString()
        })
    }
}

export default LocalFeedsDatabase