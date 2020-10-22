import { Address, DurationMsec, JSONObject, Port, UrlPath } from '../../interfaces/core'
import ExternalInterface, { ExpressInterface, HttpServerInterface, LocalFeedManagerInterface } from '../ExternalInterface'
import mockDgramCreateSocket from './mockDgramCreateSocket'
import MockKacheryStorageManager from './MockKacheryStorageManager'
import MockLocalFeedManager from './MockLocalFeedManager'
import { MockNodeDaemonGroup, MockNodeDefects } from './MockNodeDaemon'
import { mockCreateWebSocket, mockStartWebSocketServer } from './MockWebSocket'

const mockStartHttpServer = async (app: ExpressInterface, listenPort: Port): Promise<HttpServerInterface> => {
    throw Error('Unable to start http server in mock mode')
}

const mockExternalInterface = (daemonGroup: MockNodeDaemonGroup, getDefects: () => MockNodeDefects): ExternalInterface => {

    const httpPostJson = (address: Address, path: UrlPath, data: JSONObject, opts: { timeoutMsec: DurationMsec }) => {
        return daemonGroup.mockHttpPostJson(address, path, data, opts)
    }
    const httpGetDownload = (address: Address, path: UrlPath) => {
        return daemonGroup.mockHttpGetDownload(address, path)
    }

    const createLocalFeedManager = (): LocalFeedManagerInterface => {
        return new MockLocalFeedManager()
    }

    const createKacheryStorageManager = () => {
        return new MockKacheryStorageManager(getDefects)
    }

    return {
        httpPostJson,
        httpGetDownload,
        dgramCreateSocket: mockDgramCreateSocket,
        startWebSocketServer: mockStartWebSocketServer,
        createWebSocket: mockCreateWebSocket,
        createKacheryStorageManager,
        createLocalFeedManager,
        startHttpServer: mockStartHttpServer,
        isMock: true
    }
}


export default mockExternalInterface