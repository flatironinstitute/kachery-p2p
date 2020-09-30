import { _tests as interfacesCoreTests } from './interfaces/core'
import { _tests as httpPostJsonTests } from './httpPostJson'
import { _tests as udpCongestionManagerTests } from './udp/UdpCongestionManager'

// for (let testName in interfacesCoreTests) {
//     console.info(`TEST: ${testName}`)
//     try {
//         interfacesCoreTests[testName]()
//         console.info('  PASSED')
//     }
//     catch(err) {
//         console.info(`  *********** FAILED: ${testName}`)
//     }
// }

const main = async () => {
    runSyncTests(interfacesCoreTests)
    await runAsyncTests(httpPostJsonTests)
    await runAsyncTests(udpCongestionManagerTests)
}

const runSyncTests = async (x: {[key: string]: Function}) => {
    for (let testName in x) {
        console.info(`TEST: ${testName}`)
        try {
            x[testName]()
            console.info('  PASSED')
        }
        catch(err) {
            console.info(`  *********** FAILED: ${testName}`)
        }
    }
}

const runAsyncTests = async (x: {[key: string]: () => Promise<void>}) => {
    for (let testName in x) {
        console.info(`TEST: ${testName}`)
        try {
            await x[testName]()
            console.info('  PASSED')
        }
        catch(err) {
            console.info(`  *********** FAILED: ${testName}`)
        }
    }
}

main()