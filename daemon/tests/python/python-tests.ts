import child_process from 'child_process';
import fs, { mkdirSync } from 'fs';
import * as mocha from 'mocha'; // import types for mocha e.g. describe
import os from 'os';
import util from 'util';
import { parseBootstrapInfo, randomAlphaString, sleepMsec } from '../../src/common/util';
import realExternalInterface from '../../src/external/real/realExternalInterface';
import { channelName, ChannelName, FeedName, HostName, localFilePath, LocalFilePath, nodeLabel, NodeLabel, Port, scaledDurationMsec, toPort } from '../../src/interfaces/core';
import startDaemon, { DaemonInterface, StartDaemonOpts } from '../../src/startDaemon';

interface DaemonContextOpts {
    label: NodeLabel
    daemonApiPort: Port
    httpListenPort: Port
    udpSocketPort: Port
    webSocketListenPort: Port
    bootstrapAddressStrings?: string[]
    isBootstrap: boolean
    channelNames: ChannelName[]
}

const daemonContext = async (o: DaemonContextOpts[], testFunction: (daemons: DaemonInterface[], resolve: () => void, reject: (err: Error) => void) => Promise<void>, done: (err?: Error) => void) => {
    const tempPath = `${os.tmpdir()}/kachery-p2p-python-test-${randomAlphaString(10)}.tmp` as any as LocalFilePath
    fs.mkdirSync(tempPath.toString())
    let daemons: DaemonInterface[] = []
    let complete = false
    const resolve = () => {
        if (complete) return
        complete = true
        daemons.forEach(daemon => {
            daemon.stop()
        })
        fs.rmdirSync(tempPath.toString(), {recursive: true})
        done()
    }
    const reject = (err: Error) => {
        if (complete) return
        complete = true
        daemons.forEach(daemon => {
            daemon.stop()
        })
        fs.rmdirSync(tempPath.toString(), {recursive: true})
        done(err)
    }

    for (let oo of o) {
        await new Promise((next) => {
            const configDir = localFilePath(tempPath + '/' + randomAlphaString(10))
            mkdirSync(configDir.toString())
            const externalInterface = realExternalInterface(configDir, configDir)
            const getDefects = () => {
                return {}
            }
            const bootstrapAddresses = oo.bootstrapAddressStrings ? (
                oo.bootstrapAddressStrings.filter((x: any) => (typeof(x) === 'string')).map((x: string) => parseBootstrapInfo(x))
            ): []
            const opts: StartDaemonOpts = {
                bootstrapAddresses,
                isBootstrap: oo.isBootstrap || false,
                channelNames: oo.channelNames,
                multicastUdpAddress: {hostName: '237.0.0.1' as any as HostName, port: toPort(21011)},
                udpSocketPort: oo.udpSocketPort,
                webSocketListenPort: oo.webSocketListenPort,
                firewalled: false,
                services: {
                    announce: true,
                    discover: true,
                    bootstrap: true,
                    proxyClient: true,
                    multicast: true,
                    display: true,
                    udpSocket: true,
                    webSocketServer: true,
                    httpServer: true,
                    daemonServer: true
                }
            }
            
            startDaemon({
                configDir,
                verbose: 0,
                hostName: 'localhost' as any as HostName,
                daemonApiPort: oo.daemonApiPort,
                httpListenPort: oo.httpListenPort,
                label: oo.label,
                externalInterface,
                getDefects,
                opts
            }).then((d: DaemonInterface) => {
                daemons.push(d)
                next()
            }).catch((err: Error) => {
                reject(err)
            })
        })
    }
    await testFunction(daemons, resolve, reject)
}

// need to explicitly use mocha prefix once or the dependency gets wrongly cleaned up
mocha.describe('Python tests', () => {
    describe('python tests 1 aaa101', () => {
        it('test1', (done) => {
            const o1 = {
                label: nodeLabel('bootstrap'),
                daemonApiPort: toPort(6010),
                httpListenPort: toPort(7010),
                udpSocketPort: toPort(7010),
                webSocketListenPort: toPort(8010),
                bootstrapAddressStrings: [],
                isBootstrap: true,
                channelNames: [channelName('chan1')]
            }
            const o2 = {
                label: nodeLabel('daemon'),
                daemonApiPort: toPort(6011),
                httpListenPort: toPort(7011),
                udpSocketPort: toPort(7011),
                webSocketListenPort: toPort(8011),
                bootstrapAddressStrings: ['localhost:7010'],
                isBootstrap: false,
                channelNames: [channelName('chan1')]
            }
            daemonContext([o1, o2], async (daemons, resolve, reject) => {
                const d1 = daemons[0]
                const d2 = daemons[1]
                await sleepMsec(scaledDurationMsec(60000))
                if (d1.node.remoteNodeManager().getAllRemoteNodes().length !== 1) {
                    throw Error('Unexpected.')
                }

                const feedId = await d1.node.feedManager().createFeed({feedName: 'feed1' as any as FeedName})

                const pythonScript1 = await fs.promises.readFile(__dirname + '/script1.py', 'utf-8')
                const pythonScript2 = await fs.promises.readFile(__dirname + '/script2.py', 'utf-8')

                const storageDir1 = d1.node.kacheryStorageManager().storageDir()
                const storageDir2 = d2.node.kacheryStorageManager().storageDir()
                if ((storageDir1 === null) || (storageDir2 === null)) {
                    throw Error('Unexpected')
                }
                runPythonScript(o1.daemonApiPort, storageDir1, pythonScript1, {FEED_ID: feedId})
                await runPythonScript(o2.daemonApiPort, storageDir2, pythonScript2, {FEED_ID: feedId})

                resolve()
            }, done)
        }).timeout(20000)
    })
})

const runPythonScript = async (daemonApiPort: Port, tempPath: LocalFilePath, pythonScript: string, env: any) => {
    const execAsync = util.promisify(child_process.exec)
    const scriptPath = `${tempPath}/${randomAlphaString(10)}.py`
    await fs.promises.writeFile(scriptPath, pythonScript)
    const env0 = {
        KACHERY_STORAGE_DIR: tempPath.toString(),
        KACHERY_P2P_CONFIG_DIR: tempPath.toString(),
        KACHERY_P2P_API_PORT: daemonApiPort + ''
    }
    const { stdout, stderr } = await execAsync(`python3 ${scriptPath}`, {env: {...process.env, ...env0, ...env}});
    console.info(stdout)
    console.error(stderr)
}