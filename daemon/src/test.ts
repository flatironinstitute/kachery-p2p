import { _tests as interfacesCoreTests } from './interfaces/core'
import { _tests as httpPostJsonTests } from './httpPostJson'

for (let testName in interfacesCoreTests) {
    console.info(`TEST: ${testName}`)
    try {
        interfacesCoreTests[testName]()
        console.info('  PASSED')
    }
    catch(err) {
        console.info(`  *********** FAILED: ${testName}`)
    }
}

(async () => {
    for (let testName in httpPostJsonTests) {
        console.info(`TEST: ${testName}`)
        try {
            await httpPostJsonTests[testName]()
            console.info('  PASSED')
        }
        catch(err) {
            console.info(`  *********** FAILED: ${testName}`)
        }
    }
})()