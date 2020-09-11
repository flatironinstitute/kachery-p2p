#!/usr/bin/env node

import WebSocket from 'ws';
import { randomAlphaString, kacheryP2PSerialize, kacheryP2PDeserialize } from '../src/common/util.js';

const websocketServerPort = 34901;

async const step1 = () => {
    const wsClient = new WebSocket(`localhost:${websocketServerPort}`);
    wsClient.on('message', msg => {
        const message = kacheryP2PDeserialize(msg);
        console.info(message.confirmMessageId);
    });
    const x = {
        data: randomAlphaString(10000),
        messageId: randomAlphaString(10)
    }
    wsClient.send(kacheryP2PSerialize(x));
}

async const main = () => {
    const websocketServer = new WebSocket.Server({ port: websocketServerPort })
    websocketServer.on('listening', () => {
        step1();
    });
    websocketServer.on('connection', ws => {
        ws.on('message', msg => {
            const message = kacheryP2PDeserialize(msg);
            const reply = {
                confirmMessageId: message.messageId
            };
            ws.send(kacheryP2PSerialize(reply));
        })
        

    });
}

main();