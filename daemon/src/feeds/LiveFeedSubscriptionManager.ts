import { LiveFeedSubscriptions, NodeId } from "./interfaces/core";

export class LiveFeedSubscriptionManager {
    #subscriptionsByNodeId = new Map<NodeId, LiveFeedSubscriptions>();
    constructor() {
    }
    async setSubscriptions({nodeId, subscriptions}: {nodeId: NodeId, subscriptions: LiveFeedSubscriptions}) {
        this.#subscriptionsByNodeId.set(nodeId, subscriptions);
    }
}