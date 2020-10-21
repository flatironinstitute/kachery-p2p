import dgram from 'dgram';
import { localFilePath } from '../../interfaces/core';
import ExternalInterface, { LocalFeedManagerInterface } from '../ExternalInterface';
import { httpGetDownload, httpPostJson } from "./httpRequests";
import { KacheryStorageManager } from './kacheryStorage/KacheryStorageManager';
import LocalFeedManager from './LocalFeedManager';
import startHttpServer from './startHttpServer';
import { createWebSocket, startWebSocketServer } from './webSocket';

const realExternalInterface = (): ExternalInterface => {
    const storageDir = process.env['KACHERY_STORAGE_DIR']
    if (!storageDir) {
        throw Error('You must set the KACHERY_STORAGE_DIR environment variable.');
    }

    const dgramCreateSocket = (args: { type: 'udp4', reuseAddr: boolean }) => {
        return dgram.createSocket({ type: args.type, reuseAddr: args.reuseAddr })
    }

    const createKacheryStorageManager = () => {
        return new KacheryStorageManager(localFilePath(storageDir))
    }

    const createLocalFeedManager = (): LocalFeedManagerInterface => {
        return new LocalFeedManager(localFilePath(storageDir))
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