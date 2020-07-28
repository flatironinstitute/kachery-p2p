class SmartyNode {
    constructor(node) {
        this._node = node;
        this._optimalRoutesToNodes = {}; // {[channelName]: {[toNodeId]: {timestamp: ..., optimalRoute: ...}}}
    }
    async which_route_should_i_use_to_send_a_message_to_this_peer({channelName, toNodeId, calculateIfNeeded}) {
        if (!(channelName in this._optimalRoutesToNodes)) {
            this._optimalRoutesToNodes[channelName] = {};
        }
        const oo = this._optimalRoutesToNodes[channelName];
        for (let passnum = 1; passnum <= 2; passnum ++) {
            if (toNodeId in oo) {
                const {route, timestamp} = oo[toNodeId];
                const elapsed0 = (new Date() - timestamp);
                if ((elapsed0 < 10000) || (!calculateIfNeeded)) {
                    const firstNodeId = route[1];
                    const firstPC = this._swarmConnection.peerConnection(firstNodeId);
                    if ((firstPC) && (firstPC.hasDirectConnection())) {
                        return route;
                    }
                    else {
                        delete oo[toNodeId];
                    }
                }
            }
            if (passnum === 1) {
                if (!calculateIfNeeded) return null;
                const optimalRoute = await this._estimateOptimalRouteToNode({channelName, toNodeId});
                if (optimalRoute) {
                    oo[toNodeId] = {
                        route: optimalRoute,
                        timestamp: new Date()
                    };
                }
            }
        }
        return null;
    }

    async _estimateOptimalRouteToNode({channelName, toNodeId}) {
        return null; // todo
        const peerIds = this._node.getPeerIds({channelName});
        const candidatePeerIds = peerIds.filter(peerId => {
            const pc = this._swarmConnection.peerConnection(peerId);
            return ((pc) && (pc.hasDirectConnection()));
        })
        const timings = {};
        const routes = {};
        const testCandidate = (candidatePeerId) => {
            const testData = { // needs to be an object so we can compute a signature
                data1: randomString(1000)
            };
            const requestBody = {
                type: 'routeLatencyTest', // todo
                channelName,
                toNodeId,
                testData,
                avoid: {[this._swarmConnection.nodeId()]: true}
            };
            const timer = new Date();
            const req = this._node.makeRequestToNode({channelName, toNodeId: candidatePeerId, requestBody, timeout: 5000});
            let finished = false;
            let gotCorrectResponse = false;
            let responseRoute = null;
            req.onResponse(responseBody => {
                if (finished) return;
                if (JSONStringifyDeterministic(responseBody.testData) === JSONStringifyDeterministic(testData)) {
                    if (verifySignature(responseBody.testData, responseBody.testDataSignature, hexToPublicKey(toNodeId))) {
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
}

export default SmartyNode;