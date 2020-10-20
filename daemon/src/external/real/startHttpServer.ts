import fs from 'fs';
import http from 'http';
import https from 'https';
import { Port, portToNumber } from "../../interfaces/core";
import { ExpressInterface, HttpServerInterface } from '../ExternalInterface';

const startHttpServer = async (app: ExpressInterface, listenPort: Port): Promise<HttpServerInterface> => {
    // convenient for starting either as http or https depending on the port
    let protocol: 'http' | 'https'
    let server: http.Server | https.Server
    if (process.env.SSL != null ? process.env.SSL : portToNumber(listenPort) % 1000 == 443) {
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
        server = https.createServer(options, app as http.RequestListener);
    } else {
        protocol = 'http';
        // Create the http server and start listening
        server = http.createServer(app as http.RequestListener);
    }
    server.listen(portToNumber(listenPort));
    await new Promise((resolve, reject) => {
        server.on('listening', () => {
            resolve()
        })
    })
    return server
}

export default startHttpServer