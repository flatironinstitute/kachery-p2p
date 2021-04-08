import { Database, open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { JSONStringifyDeterministic } from '../common/crypto_util';
import { sleepMsec } from '../common/util';
import { JSONValue, LocalFilePath, Sha1Hash, unscaledDurationMsec } from '../interfaces/core';

export type MutableRecord = {
    key: JSONValue
    value: JSONValue
}

class MutableDatabase {
    #db: Database | null = null
    #initializing = false
    #initialized = false
    #databaseLocked = false
    #onDatabaseLockReleasedCallbacks: (() => void)[] = []
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
                CREATE TABLE IF NOT EXISTS mutables (
                    sha1 TEXT PRIMARY KEY NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL
                ) WITHOUT ROWID;
            `)
        }
        const db = await this._openDatabase()
        try {
            await db.run(`PRAGMA foreign_keys = ON`)
            await createTables(db)
        }
        finally {
            await this._closeDatabase()
        }
        this.#initialized = true
        this.#initializing = false
    }
    async _acquireDatabaseLock() {
        if (!this.#databaseLocked) {
            this.#databaseLocked = true
            return
        }
        await new Promise<void>((resolve) => {
            this.#onDatabaseLockReleasedCallbacks.push(() => {
                this.#databaseLocked = true
                resolve()
            })
        })
    }
    _releaseDatabaseLock() {
        if (!this.#databaseLocked) {
            throw Error('Unexpected: (mutable db) cannot release database lock when it is not locked')
        }
        this.#databaseLocked = false
        if (this.#onDatabaseLockReleasedCallbacks.length > 0) {
            const cb = this.#onDatabaseLockReleasedCallbacks[0]
            this.#onDatabaseLockReleasedCallbacks = this.#onDatabaseLockReleasedCallbacks.slice(1)
            cb()
        }
    }
    async _openDatabase() {
        await this._acquireDatabaseLock()
        this.#db = await open({filename: this.databasePath.toString(), driver: sqlite3.Database})
        return this.#db
    }
    async _closeDatabase() {
        if (!this.#db) throw Error('Unexpected in closeDatabase: (mutable db) database is null')
        await this.#db.close()
        this._releaseDatabaseLock()
    }
    async set(sha1: Sha1Hash, record: MutableRecord) {
        await this._initialize()
        const db = await this._openDatabase()
        try {
            await db.run('BEGIN TRANSACTION')
            await db.run(`
                INSERT OR REPLACE INTO mutables (sha1, key, value) VALUES ($sha1, $key, $value)
            `, {
                '$sha1': sha1.toString(),
                '$key': JSONStringifyDeterministic(record.key as Object),
                '$value': JSONStringifyDeterministic(record.value as Object)
            })
            await db.run('COMMIT')
        }
        finally {
            await this._closeDatabase()
        }
    }
    async delete(sha1: Sha1Hash) {
        await this._initialize()
        const db = await this._openDatabase()
        try {
            await db.run('BEGIN TRANSACTION')
            await db.run(`
                DELETE FROM mutables WHERE sha1 = $sha1
            `, {
                '$sha1': sha1.toString()
            })
            await db.run('COMMIT')
        }
        finally {
            await this._closeDatabase()
        }
    }
    async has(sha1: Sha1Hash): Promise<boolean> {
        await this._initialize()
        const db = await this._openDatabase()
        try {
            const row = await db.get(`
                SELECT sha1 FROM mutables WHERE sha1 = $sha1
            `, {
                '$sha1': sha1.toString()
            })
            if (row) {
                if (row.sha1 === sha1.toString()) {
                    return true
                }
                else {
                    // not expected, but checking anyway
                    throw Error('Unexpected: mismatch in sha1')
                }
            }
            else {
                return false
            }
        }
        finally {
            await this._closeDatabase()
        }
    }
    async get(sha1: Sha1Hash): Promise<MutableRecord | undefined> {
        await this._initialize()
        const db = await this._openDatabase()
        try {
            const rows: {key: string, value: string}[] = await db.all(`
                SELECT key, value FROM mutables WHERE sha1 = $sha1
            `, {
                '$sha1': sha1.toString()
            })
            if (!rows) {
                throw Error('Unexpected: (mutable db) rows undefined')
            }
            if (rows.length == 0) return undefined
            if (rows.length > 1) {
                throw Error('Unexpected: (mutable db) more than one row found for primary key')
            }
            const row = rows[0]
            const rec: MutableRecord = {
                key: JSON.parse(row.key),
                value: JSON.parse(row.value)
            }
            return rec
        }
        finally {
            await this._closeDatabase()
        }
    }
}

export default MutableDatabase