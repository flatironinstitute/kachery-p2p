import { Address, DurationMsec, JSONObject, UrlPath } from '../../interfaces/core'
import ExternalInterface from '../ExternalInterface'
import mockDgramCreateSocket from './mockDgramCreateSocket'
import MockKacheryStorageManager from './MockKacheryStorageManager'
import { MockNodeDaemonGroup } from './MockNodeDaemon'
import { mockCreateWebSocket, mockCreateWebSocketServer } from './MockWebSocket'


const mockExternalInterface = (daemonGroup: MockNodeDaemonGroup): ExternalInterface => {

    const httpPostJsonFunction = (address: Address, path: UrlPath, data: JSONObject, opts: { timeoutMsec: DurationMsec }) => {
        return daemonGroup.mockHttpPostJson(address, path, data, opts)
    }
    const httpGetDownloadFunction = (address: Address, path: UrlPath) => {
        return daemonGroup.mockHttpGetDownload(address, path)
    }
    return {
        httpPostJsonFunction,
        httpGetDownloadFunction,
        dgramCreateSocketFunction: mockDgramCreateSocket,
        createWebSocketServerFunction: mockCreateWebSocketServer,
        createWebSocketFunction: mockCreateWebSocket,
        kacheryStorageManager: new MockKacheryStorageManager(),
    }
}


export default mockExternalInterface