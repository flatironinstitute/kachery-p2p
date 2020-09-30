import { _tests as interfacesCoreTests } from './interfaces/core'

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