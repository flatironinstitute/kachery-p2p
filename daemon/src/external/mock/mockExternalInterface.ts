import { Address, DurationMsec, JSONObject, Port, UrlPath } from '../../interfaces/core'
import ExternalInterface, { ExpressInterface, HttpServerInterface } from '../ExternalInterface'
import mockDgramCreateSocket from './mockDgramCreateSocket'
import MockKacheryStorageManager from './MockKacheryStorageManager'
import { MockNodeDaemonGroup } from './MockNodeDaemon'
import { mockCreateWebSocket, mockCreateWebSocketServer } from './MockWebSocket'

const mockStartHttpServer = (app: ExpressInterface, listenPort: Port): HttpServerInterface => {
    throw Error('Unable to start http server in mock mode')
}

const mockExternalInterface = (daemonGroup: MockNodeDaemonGroup): ExternalInterface => {

    const httpPostJson = (address: Address, path: UrlPath, data: JSONObject, opts: { timeoutMsec: DurationMsec }) => {
        return daemonGroup.mockHttpPostJson(address, path, data, opts)
    }
    const httpGetDownload = (address: Address, path: UrlPath) => {
        return daemonGroup.mockHttpGetDownload(address, path)
    }
    return {
        httpPostJson,
        httpGetDownload,
        dgramCreateSocket: mockDgramCreateSocket,
        createWebSocketServer: mockCreateWebSocketServer,
        createWebSocket: mockCreateWebSocket,
        createKacheryStorageManager: () => (new MockKacheryStorageManager()),
        startHttpServer: mockStartHttpServer
    }
}


export default mockExternalInterface