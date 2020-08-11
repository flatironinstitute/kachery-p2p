#!/usr/bin/env node

import WebSocket from 'ws';
import { randomAlphaString, sleepMsec, kacheryP2PDeserialize, kacheryP2PSerialize } from '../common/util.js';

const PORT = 34901;
const NUM_MESSAGES = 10000;
const DATA_SIZE = 10000;

const step1 = async () => {
    let pendingMessageIds = {};
    let numConfirmed = 0;
    let timer = null;

    const finalize = () => {
        const elapsed = (new Date()) - timer;
        const bytes_per_sec = NUM_MESSAGES * DATA_SIZE / (elapsed / 1000);
        console.log(`Elapsed (sec): ${elapsed/1000}, ${bytes_per_sec / 1000000} MiB/sec`);
    }

    const wsClient = new WebSocket(`ws://localhost:${PORT}`);
    wsClient.on('message', msg => {
        const message = kacheryP2PDeserialize(msg);
        if (message.confirmMessageId in pendingMessageIds) {
            delete pendingMessageIds[message.confirmMessageId];
            numConfirmed ++;
            if (numConfirmed === NUM_MESSAGES) {
                finalize();
            }
        }
        console.info(message.confirmMessageId);
    });

    const sendMessage = async (client, msg) => {
        return new Promise((resolve, reject) => {
            const msgSerialized = kacheryP2PSerialize(msg);
            client.send(msgSerialized);
            resolve();
        })
    }

    const startSending = async () => {
        timer = new Date();
        for (let i=0; i<NUM_MESSAGES; i++) {
            const messageId = randomAlphaString(10);
            pendingMessageIds[messageId] = true;
            const x = {
                data: randomAlphaString(DATA_SIZE),
                messageId
            }
            await sendMessage(wsClient, x);
            await sleepMsec(1);
        }
    }

    wsClient.on('open', () => {
        startSending();
    });
}

const main = async () => {
    const websocketServer = new WebSocket.Server({ port: PORT })
    websocketServer.on('listening', () => {
        step1();
    });
    websocketServer.on('connection', ws => {
        ws.on('message', msg => {
            const message = kacheryP2PDeserialize(msg);
            const reply = {
                confirmMessageId: message.messageId
            };
            const replySerialized = kacheryP2PSerialize(reply);
            ws.send(replySerialized);
        })
    });
}

main();