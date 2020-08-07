import assert from 'assert';
import { getSignature, JSONStringifyDeterministic, verifySignature, hexToPublicKey } from "./common//crypto_util.js";
import { randomString, sleepMsec } from "./common//util.js";
import { validateObject, validateChannelName, validateNodeId } from "./schema/index.js";

class SmartyNode {
    constructor(node) {
        this._node = node;
        this._remoteNodeManager = this._node._remoteNodeManager;
        this._optimalRoutesToNodes = {}; // {[channelName]: {[toNodeId]: {timestamp: ..., optimalRoute: ...}}}
        this._node.onRequest(({channelName, fromNodeId, requestBody, sendResponse, reportError, reportFinished, onCanceled, onResponseReceived}) => {
            if (requestBody.type === 'routeLatencyTest') {
                this._handleRouteLatencyTest({channelName, fromNodeId, requestBody, sendResponse, reportError, reportFinished, onCanceled, onResponseReceived});
            }
        });
    }
    async which_route_should_i_use_to_send_a_message_to_this_node({channelName, toNodeId, calculateIfNeeded}) {
        validateChannelName(channelName);
        validateNodeId(toNodeId);
        assert(typeof(calculateIfNeeded) === 'boolean');

        if (!(channelName in this._optimalRoutesToNodes)) {
            this._optimalRoutesToNodes[channelName] = {};
        }
        const optimalRoutes = this._optimalRoutesToNodes[channelName];
        for (let passnum = 1; passnum <= 2; passnum ++) {
            if (toNodeId in optimalRoutes) {
                const {route, timestamp} = optimalRoutes[toNodeId];
                const elapsed0 = (new Date() - timestamp);
                if ((elapsed0 < 10000) || ((!calculateIfNeeded) && (elapsed0 < 30000))) {
                    const firstPeerId = route[1];
                    if (this._remoteNodeManager.isPeer(firstPeerId)) {
                        return route;
                    }
                    else {
                        delete optimalRoutes[toNodeId];
                    }
                }
            }
            if (passnum === 1) {
                if (!calculateIfNeeded) return null;
                const optimalRoute = await this._estimateOptimalRouteToNode({channelName, toNodeId});
                if (optimalRoute) {
                    optimalRoutes[toNodeId] = {
                        route: optimalRoute,
                        timestamp: new Date()
                    };
                }
            }
        }
        return null;
    }

    async _estimateOptimalRouteToNode({channelName, toNodeId}) {
        validateChannelName(channelName);
        validateNodeId(toNodeId);

        const candidatePeerIds = this._remoteNodeManager.peerIdsForChannel(channelName);
        const timings = {};
        const routes = {};
        const testCandidate = (candidatePeerId) => {
            const testData = { // needs to be an object so we can compute a signature
                data1: randomString(1000)
            };
            const requestBody = {
                type: 'routeLatencyTest',
                channelName,
                toNodeId,
                testData,
                avoid: [this._node.nodeId()]
            };
            const timer = new Date();
            const req = this._node.makeRequestToNode({
                channelName,
                toNodeId: candidatePeerId,
                requestBody,
                direct: true,
                timeout: 5000
            });
            let finished = false;
            let gotCorrectResponse = false;
            let responseRoute = null;
            req.onResponse(responseBody => {
                if (finished) return;
                if (JSONStringifyDeterministic(responseBody.testData) === JSONStringifyDeterministic(testData)) {
                    if (verifySignature(responseBody.testData, responseBody.testDataSignature, hexToPublicKey(toNodeId))) {
                        gotCorrectResponse = true;
                        responseRoute = [this._node.nodeId(), ...responseBody.route];
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
    async _handleRouteLatencyTest({channelName, fromNodeId, requestBody, sendResponse, reportError, reportFinished, onCanceled, onResponseReceived}) {
        validateChannelName(channelName);
        validateObject(requestBody, '/RouteLatencyTestRequest');
        validateNodeId(requestBody.toNodeId);
        assert(typeof(requestBody.testData) === 'string');
        assert(Array.isArray(requestBody.avoid));

        const {toNodeId, testData, avoid} = requestBody;
        if (toNodeId === this._node.nodeId()) {
            sendResponse({
                route: [toNodeId],
                testData,
                testDataSignature: getSignature(testData, this._node._keyPair)
            });
            reportFinished();
            return;
        }
        // for now we only test routes of length 2
        // in future we can use the already-determined optimal route (and checking it does not contain the avoid stuff)
        if (this._remoteNodeManager.isPeer(toNodeId)) {
            const req = this._node.makeRequestToNode({
                channelName,
                toNodeId: toNodeId,
                direct: true, // ensure that we are going directly to the node
                requestBody: {
                    type: 'routeLatencyTest',
                    toNodeId,
                    testData,
                    avoid: [...avoid, this._node.nodeId()]
                },
                timestamp: 5000
            });
            req.onResponse(responseBody => {
                sendResponse({
                    route: [this._node.nodeId(), ...responseBody.route],
                    testData: responseBody.testData,
                    testDataSignature: responseBody.testDataSignature
                })
            });
            req.onError((e) => {
                reportError(e);
            });
            req.onFinished(() => {
                reportFinished();
            });
            return;
        }
        else {
            reportError('No route found.');
        }
    }
}

export default SmartyNode;