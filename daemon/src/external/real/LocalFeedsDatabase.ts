import { Database, open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { JSONStringifyDeterministic } from '../../common/crypto_util';
import { sleepMsec } from '../../common/util';
import { FeedId, isJSONObject, isSignedSubfeedMessage, isString, isSubfeedAccessRules, LocalFilePath, SignedSubfeedMessage, SubfeedAccessRules, SubfeedHash, unscaledDurationMsec } from "../../interfaces/core";

class LocalFeedsDatabase {
    #db: Database | null = null
    #initializing = false
    #initialized = false
    constructor(private databasePath: LocalFilePath) {
    }
    async _initialize() {
        if (this.#initialized) return
        while (this.#initializing) {
            await sleepMsec(unscaledDurationMsec(100))
        }
        if (this.#initialized) return
        this.#initializing = true
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
        db.close()
        this.#initialized = true
        this.#initializing = false
    }
    async _openDatabase() {
        await this._initialize()
        const db = await open({filename: this.databasePath.toString(), driver: sqlite3.Database})
        return db
    }
    async addFeed(feedId: FeedId) {
        const db = await this._openDatabase()
        await db.run('BEGIN TRANSACTION')
        await db.run(`
            INSERT INTO feeds (feedId) VALUES ($feedId)
        `, {
            '$feedId': feedId.toString()
        })
        await db.run('COMMIT')
        await db.close()
    }
    async deleteFeed(feedId: FeedId) {
        const db = await this._openDatabase()
        try {
            await db.run('BEGIN TRANSACTION')
            await db.run(`
                DELETE FROM feeds WHERE feedId = $feedId
            `, {
                '$feedId': feedId.toString()
            })
            await db.run('COMMIT')
        }
        finally {
            db.close()
        }
    }
    async hasFeed(feedId: FeedId): Promise<boolean> {
        const db = await this._openDatabase()
        try {
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
                    // not expected, but checking anyway
                    throw Error('Unexpected: mismatch in feedId')
                }
            }
            else {
                return false
            }
        }
        finally {
            db.close()
        }
    }
    async getSignedSubfeedMessages(feedId: FeedId, subfeedHash: SubfeedHash): Promise<SignedSubfeedMessage[]> {
        const db = await this._openDatabase()
        try {
            const rows: {message: string, position: number}[] = await db.all(`
                SELECT message, position FROM subfeedMessages WHERE feedId = $feedId AND subfeedHash = $subfeedHash ORDER BY position ASC
            `, {
                '$feedId': feedId.toString(),
                '$subfeedHash': subfeedHash.toString()
            })
            if (!rows) {
                throw Error('Unexpected: rows undefined')
            }
            const ret: SignedSubfeedMessage[] = []
            for (let i = 0; i < rows.length; i ++) {
                const row = rows[i]
                if (row.position !== i) {
                    // this enforces that feed messages are unreadable if they have gaps,
                    // but the way feed message numbers are assigned in FeedManager should keep that from ever happening.
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
        finally {
            db.close()
        }
    }
    async getSubfeedAccessRules(feedId: FeedId, subfeedHash: SubfeedHash): Promise<SubfeedAccessRules | null> {
        const db = await this._openDatabase()
        try {
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
        finally {
            db.close()
        }
    }
    async setSubfeedAccessRules(feedId: FeedId, subfeedHash: SubfeedHash, accessRules: SubfeedAccessRules): Promise<void> {
        const db = await this._openDatabase()
        try {
            await this._createFeedRowIfNeeded(db, feedId)
            await db.run('BEGIN TRANSACTION')
            await db.run(`
                INSERT OR REPLACE INTO subfeeds (feedId, subfeedHash, accessRules) VALUES ($feedId, $subfeedHash, $accessRules)
            `, {
                '$feedId': feedId.toString(),
                '$subfeedHash': subfeedHash.toString(),
                '$accessRules': JSONStringifyDeterministic(accessRules)
            })
            await db.run('COMMIT')
        }
        finally {
            db.close()
        }
    }
    async appendSignedMessagesToSubfeed(feedId: FeedId, subfeedHash: SubfeedHash, messages: SignedSubfeedMessage[]) {
        const db = await this._openDatabase()
        try {
            if (messages.length === 0) return
            // CHAIN:append_messages:step(7)
            console.log('--------------------------- A7')
            await this._createSubfeedRowIfNeeded(db, feedId, subfeedHash)
            const data = messages.map(m => ({
                feedId,
                subfeedHash,
                position: m.body.messageNumber,
                message: JSONStringifyDeterministic(m)
            }))
            await db.run('BEGIN TRANSACTION')
            for (let d of data) {
                // await fs.promises.appendFile(this.databasePath + '.debug', JSON.stringify({feedId: d.feedId, subfeedHash: d.subfeedHash, position: d.position, message: d.message}) + '\n')
                await db.run(`
                    INSERT INTO subfeedMessages (feedId, subfeedHash, position, message) VALUES ($feedId, $subfeedHash, $position, $message)
                `, {
                    '$feedId': d.feedId,
                    '$subfeedHash': d.subfeedHash,
                    '$position': d.position,
                    '$message': d.message
                })
            }
            await db.run('COMMIT')
        }
        finally {
            db.close()
            // CHAIN:append_messages:step(8)
            console.log('--------------------------- A8')
        }
    }
    async _createFeedRowIfNeeded(db: Database, feedId: FeedId) {
        await db.run(`
            INSERT OR IGNORE INTO feeds (feedId) VALUES ($feedId)
        `, {
            '$feedId': feedId.toString()
        })
    }
    async _createSubfeedRowIfNeeded(db: Database, feedId: FeedId, subfeedHash: SubfeedHash) {
        await this._createFeedRowIfNeeded(db, feedId)
        await db.run(`
            INSERT OR IGNORE INTO subfeeds (feedId, subfeedHash) VALUES ($feedId, $subfeedHash)
        `, {
            '$feedId': feedId.toString(),
            '$subfeedHash': subfeedHash.toString()
        })
    }
}

export default LocalFeedsDatabase