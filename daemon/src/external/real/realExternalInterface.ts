import dgram from 'dgram';
import { LocalFilePath } from '../../interfaces/core';
import ExternalInterface, { LocalFeedManagerInterface } from '../ExternalInterface';
import { httpGetDownload, httpPostJson } from "./httpRequests";
import { KacheryStorageManager } from './kacheryStorage/KacheryStorageManager';
import LocalFeedManager from './LocalFeedManager';
import startHttpServer from './startHttpServer';
import { createWebSocket, startWebSocketServer } from './webSocket';

const realExternalInterface = (storageDir: LocalFilePath, configDir: LocalFilePath): ExternalInterface => {
    const dgramCreateSocket = (args: { type: 'udp4', reuseAddr: boolean }) => {
        return dgram.createSocket({ type: args.type, reuseAddr: args.reuseAddr })
    }

    const createKacheryStorageManager = () => {
        return new KacheryStorageManager(storageDir)
    }

    const createLocalFeedManager = (): LocalFeedManagerInterface => {
        return new LocalFeedManager(storageDir, configDir)
    }

    return {
        httpPostJson,
        httpGetDownload,
        dgramCreateSocket,
        startWebSocketServer,
        createWebSocket,
        createKacheryStorageManager,
        createLocalFeedManager,
        startHttpServer,
        isMock: false
    }
}

export default realExternalInterface