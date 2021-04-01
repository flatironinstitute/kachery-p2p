import { randomAlphaString, sleepMsec } from "../common/util";
import { scaledDurationMsec, _validateObject } from "../interfaces/core";
import KacheryP2PNode from "../KacheryP2PNode";
import child_process from 'child_process'
import fs from 'fs'
import { userInfo } from 'os'

export default class ClientAuthService {
    #node: KacheryP2PNode
    #halted = false
    #currentClientAuthCode = createClientAuthCode()
    constructor(node: KacheryP2PNode, private opts: {clientAuthGroup: string | null}) {
        this.#node = node

        this._start()
    }
    stop() {
        this.#halted = true
    }
    async _start() {
        const intervalMsec = scaledDurationMsec(1000 * 60 * 3)
        // this service should not wait before starting
        while (true) {
            if (this.#halted) return
            
            const previous = this.#currentClientAuthCode
            this.#currentClientAuthCode = createClientAuthCode()
            const clientAuthPath = this.#node.kacheryStorageManager().storageDir() + '/client-auth'
            await fs.promises.writeFile(clientAuthPath, this.#currentClientAuthCode, {mode: fs.constants.S_IRUSR | fs.constants.S_IRGRP | fs.constants.S_IWUSR})
            const group = this.opts.clientAuthGroup
            if (group) {
                const user = userInfo().username
                try {
                    child_process.execSync(`chown ${user}:${group} ${clientAuthPath}`);
                }
                catch(e) {
                    console.warn(`Problem setting ownership of client auth file. Perhaps you do not belong to group "${group}".`, e.message)
                    console.warn('ABORTING')
                    process.exit(1)
                }
            }
            this.#node.setClientAuthCode(this.#currentClientAuthCode, previous)

            await sleepMsec(intervalMsec, () => {return !this.#halted})
        }
    }
}

const createClientAuthCode = () => {
    return randomAlphaString(12)
}