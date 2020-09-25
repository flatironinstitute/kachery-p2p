import fs from 'fs';
import https from 'https';
import http from 'http';
import { Express } from 'express';
import { Port, toNumber } from '../interfaces/core';

const start_http_server = (app: Express, listen_port: Port, stopper: {onStop: (callback: () => void) => void}) => {
    // convenient for starting either as http or https depending on the port
    let protocol: 'http' | 'https';
    let server: http.Server | https.Server;
    if (process.env.SSL != null ? process.env.SSL : toNumber(listen_port) % 1000 == 443) {
        // The port number ends with 443, so we are using https
        // app.USING_HTTPS = true;
        protocol = 'https';
        // Look for the credentials inside the encryption directory
        // You can generate these for free using the tools of letsencrypt.org
        const options = {
            key: fs.readFileSync(__dirname + '/encryption/privkey.pem'),
            cert: fs.readFileSync(__dirname + '/encryption/fullchain.pem'),
            ca: fs.readFileSync(__dirname + '/encryption/chain.pem')
        };

        // Create the https server
        server = https.createServer(options, app);
    } else {
        protocol = 'http';
        // Create the http server and start listening
        server = http.createServer(app);
    }
    stopper.onStop(() => {
        server.close();
    });
    server.listen(listen_port);
    console.info('API server is running', {protocol, port: listen_port}, {print: true});
}

export default start_http_server;