import { randomString, sleepMsec } from "../common/util.js";
import { getSignature, verifySignature, JSONStringifyDeterministic, hexToPublicKey } from '../common/crypto_util.js';

class SmartySwarmConnection {
    constructor(swarmConnection) {
        this._swarmConnection = swarmConnection;
        this._optimalRoutesToPeers = {}; // {[peerId]: {timestamp: ..., optimalRoute: ...}}

        this._swarmConnection.onPeerRequest(({fromNodeId, requestBody, onResponse, onError, onFinished}) => {
            const type0 = requestBody.type;
            if (type0 === 'routeLatencyTest') {
                this._handleRouteLatencyTest({fromNodeId, requestBody, onResponse, onError, onFinished});
            }
            else if (type0 === 'checkAlive') {
                this._handleCheckAlive({fromNodeId, requestBody, onResponse, onError, onFinished});
            }
        });

        this._start();
    }
    async which_route_should_i_use_to_send_a_message_to_this_peer(peerId, {calculateIfNeeded}) {
        for (let passnum = 1; passnum <= 2; passnum ++) {
            if (peerId in this._optimalRoutesToPeers) {
                const {route, timestamp} = this._optimalRoutesToPeers[peerId];
                const elapsed0 = (new Date() - timestamp);
                if ((elapsed0 < 10000) || (!calculateIfNeeded)) {
                    const firstNodeId = route[1];
                    const firstPC = this._swarmConnection.peerConnection(firstNodeId);
                    if ((firstPC) && (firstPC.hasWebsocketConnection())) {
                        return route;
                    }
                    else {
                        delete this._optimalRoutesToPeers[peerId];
                    }
                }
            }
            if (passnum === 1) {
                if (!calculateIfNeeded) return null;
                const optimalRoute = await this._estimateOptimalRouteToPeer(peerId);
                if (optimalRoute) {
                    this._optimalRoutesToPeers[peerId] = {
                        route: optimalRoute,
                        timestamp: new Date()
                    };
                }
            }
        }
        return null;
    }

    async _estimateOptimalRouteToPeer(peerId) {
        const peerIds = this._swarmConnection.peerIds();
        const candidatePeerIds = peerIds.filter(peerId => {
            const pc = this._swarmConnection.peerConnection(peerId);
            return ((pc) && (pc.hasWebsocketConnection()));
        })
        const timings = {};
        const routes = {};
        const testCandidate = (candidatePeerId) => {
            const testData = { // needs to be an object so we can compute a signature
                data1: randomString(1000)
            };
            const requestBody = {
                type: 'routeLatencyTest',
                toPeerId: peerId,
                testData,
                avoid: {[this._swarmConnection.nodeId()]: true}
            };
            const timer = new Date();
            const req = this._swarmConnection.makeRequestToPeer(candidatePeerId, requestBody, {timeout: 5000});
            let finished = false;
            let gotCorrectResponse = false;
            let responseRoute = null;
            req.onResponse(responseBody => {
                if (finished) return;
                if (JSONStringifyDeterministic(responseBody.testData) === JSONStringifyDeterministic(testData)) {
                    if (verifySignature(responseBody.testData, responseBody.testDataSignature, hexToPublicKey(peerId))) {
                        gotCorrectResponse = true;
                        responseRoute = [this._swarmConnection.nodeId(), ...responseBody.route];
                    }
                }
            });
            req.onError(errorString => {
                if (finished) return;
                finished = true;
                timings[candidatePeerId] = null;
                routes[candidatePeerId] = null;
            })
            req.onFinished(() => {
                if (finished) return;
                finished = true;
                if (gotCorrectResponse) {
                    const elapsed = (new Date()) - timer;
                    timings[candidatePeerId] = elapsed;
                    routes[candidatePeerId] = responseRoute;
                }
                else {
                    timings[candidatePeerId] = null;
                    routes[candidatePeerIds] = null;
                }
            });
        }
        // launch these tests simultaneously (without async)
        for (let candidatePeerId of candidatePeerIds) {
            testCandidate(candidatePeerId)
        }
        while (true) {
            function getBestRouteFromTimings() {
                let bestTiming = null;
                let bestCandidatePeerId = null;
                for (let candidatePeerId of candidatePeerIds) {
                    const timing0 = timings[candidatePeerId];
                    if (timing0 !== null) {
                        if ((bestTiming === null) || (timing0 < bestTiming)) {
                            bestTiming = timing0;
                            bestCandidatePeerId = candidatePeerId;
                        }
                    }
                }
                if (bestCandidatePeerId === null)
                    return null;
                return routes[bestCandidatePeerId];
            }
            const bestRoute = getBestRouteFromTimings();
            if (bestRoute) {
                return bestRoute;
            }
            if (Object.keys(timings).length === candidatePeerIds.length)
                return null;
            await sleepMsec(10);
        }
    }

    async _handleRouteLatencyTest({fromNodeId, requestBody, onResponse, onError, onFinished}) {
        const {toPeerId, testData, avoid} = requestBody;
        if (toPeerId === this._swarmConnection.nodeId()) {
            onResponse({
                route: [toPeerId],
                testData,
                testDataSignature: getSignature(testData, this._swarmConnection._keyPair)
            });
            onFinished();
            return;
        }
        // for now we only test routes of length 2
        // in future we can use the already-determined optimal route (and checking it does not contain the avoid stuff)
        const pc = this._swarmConnection.peerConnection(toPeerId);
        if ((pc) && (pc.hasWebsocketConnection())) {
            const req = this._swarmConnection.makeRequestToPeer(toPeerId, {
                type: 'routeLatencyTest',
                toPeerId,
                testData,
                avoid: {...avoid, [this._swarmConnection.nodeId()]: true}
            }, {timeout: 5000});
            req.onResponse(responseBody => {
                onResponse({
                    route: [this._swarmConnection.nodeId(), ...responseBody.route],
                    testData: responseBody.testData,
                    testDataSignature: responseBody.testDataSignature
                })
            });
            req.onError((e) => {
                onError(e);
            });
            req.onFinished(() => {
                onFinished();
            });
            return;
        }
        else {
            onError('No route found.');
        }
    }
    async _handleCheckAlive({fromNodeId, requestBody, onResponse, onError, onFinished}) {
        const {testData} = requestBody;
        onResponse({
            testData,
            testDataSignature: getSignature(testData, this._swarmConnection._keyPair)
        });
        onFinished();
    }

    async _updateRoutesToPeers() {
        const peerIds = this._swarmConnection.peerIds();
        for (let peerId of peerIds) {
            const pc = this._swarmConnection.peerConnection(peerId);
            if (pc) {
                if (!pc.hasWebsocketConnection()) {
                    const _ = await this.which_route_should_i_use_to_send_a_message_to_this_peer(peerId, {calculateIfNeeded: true});
                }
            }
        }
    }

    async _checkPeerAlive(peerId) {
        return new Promise((resolve, reject) => {
            const testData = { // needs to be an object so we can compute a signature
                data1: randomString(20)
            };
            const requestBody = {
                type: 'checkAlive',
                testData
            };
            const req = this._swarmConnection.makeRequestToPeer(peerId, requestBody, {timeout: 5000});
            let finished = false;
            let gotCorrectResponse = false;
            req.onResponse(responseBody => {
                if (finished) return;
                if (JSONStringifyDeterministic(responseBody.testData) === JSONStringifyDeterministic(testData)) {
                    if (verifySignature(responseBody.testData, responseBody.testDataSignature, hexToPublicKey(peerId))) {
                        gotCorrectResponse = true;
                    }
                }
            });
            req.onError(errorString => {
                if (finished) return;
                finished = true;
                resolve(false);
            })
            req.onFinished(() => {
                if (finished) return;
                finished = true;
                if (gotCorrectResponse) {
                    resolve(true);
                }
                else {
                    resolve(false);
                }
            });
        })
    }

    async _checkPeersAlive() {
        const peerIds = this._swarmConnection.peerIds();
        for (let peerId of peerIds) {
            const alive = await this._checkPeerAlive(peerId);
            if (!alive) {
                this._swarmConnection.disconnectPeerConnection(peerId);
            }
        }
    }

    async _startCheckPeersAlive() {
        while (true) {
            await this._checkPeersAlive();
            await sleepMsec(10000);
        }
    }
    async _startUpdateRoutesToPeers() {
        while (true) {
            await this._updateRoutesToPeers();
            await sleepMsec(10000);
        }
    }

    async _start() {
        this._startCheckPeersAlive();
        this._startUpdateRoutesToPeers();
    }
}

export default SmartySwarmConnection;