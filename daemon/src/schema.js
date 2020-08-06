const addressSchema = {
    "id": "/Address",
    "anyOf": [
        {
            "type": "string",
            "minLength": 2,
            "maxLength": 80
        },
        {
            "type": "null"
        }
    ]
}

const portSchema = {
    "id": "/Port",
    "anyOf": [
        {
            "type": "number"
        },
        {
            "type": "null"
        }
    ]
}

const labelSchema = {
    "id": "/Label",
    "type": "string",
    "minLength": 1,
    "maxLength": 80
}

const nodeInfoSchema = {
    "id": "/NodeInfo",
    "type": "object",
    "properties": {
        "nodeId": {"$ref": "/NodeId"}, // todo
        "address": {"$ref": "/Address"},
        "port": {"$ref": "/Port"},
        "udpAddress": {"$ref": "/Address"},
        "udpPort": {"$ref": "/Port"},
        "label": {"$ref": "/Label"}
    }
}

const broadcastMessageSchema = {
    "id": "/BroadcastMessage",
    "type": "object",
    "properties": {
        "type": "broadcast",
        "body": {
            "type": "object",
            "properties": {
                "channelName": {"$ref": "/ChannelName"}, // todo
                "broadcastMessageId": {"$ref": "/MessageId"}, // todo
                "fromNodeId": {"$ref": "/NodeId"},
                "message": {"$ref": "/Message"}, // todo
                "timestamp": {"$ref": "/Timestamp"} // todo
            }
        },
        "signature": {"$ref": "/Signature"} // todo
    }
}

const messageToNodeSchema = {
    "id": "/MessageToNode",
    "type": "object",
    "properties": {
        "type": "messageToNode",
        "body": {
            "type": "object",
            "properties": {
                "channelName": {"$ref": "/ChannelName"}, // todo
                "fromNodeId": {"$ref": "/NodeId"},
                "toNodeId": {"$ref": "/NodeId"},
                "route": {
                    "type": "array",
                    "item": {"$ref": "/NodeId"}
                }, // todo
                "message": {"$ref": "/Message"},
                "timestamp": {"$ref": "/Timestamp"} // todo
            }
        },
        "signature": {"$ref": "/Signature"} // todo
    }
}

const requestToNodeSchema = {
    "id": "/RequestToNode",
    "type": "object",
    "properties": {
        "channelName": {"$ref": "/ChannelName"},
        "requestId": {"$ref": "/MessageId"},
        "requestBody": {"$ref", "/RequestBody"} // todo
    }
}

const requestToNodeResponseReceivedMessageSchema = {
    "id": "/RequestToNodeResponseReceivedMessage",
    "type": "object",
    "properties": {
        "type": "requestToNodeResponseReceived",
        "channelName": {"$ref": "/ChannelName"}, // todo
        "requestId": {"$ref": "/MessageId"},
        "responseIndex": {"type": "number"}
    }
}

const cancelRequestToNodeMessageSchema = {
    "id": "/CancelRequestToNodeMessage",
    "type": "object",
    "properties": {
        "type": "cancelRequestToNode",
        "channelName": {"$ref": "/ChannelName"}, // todo
        "requestId": {"$ref": "/MessageId"}
    }
}

const seekingMessage = {
    "id": "/SeekingMessage",
    "type": "object",
    "properties": {
        "type": "seeking",
        "channelName": {"$ref": "/ChannelName"},
        "fileKey": {"$ref": "/FileKey"}, // todo
    }
}

const downloadFileMessage = {
    "id": "/DownloadFileMessage",
    "type": "object",
    "properties": {
        "type": "downloadFile",
        "startByte": {"type": "number"},
        "endByte": {"type": "number"}
    }
}

const getLiveFeedSignedMessagesMessage = {
    "id": "/GetLiveFeedSignedMessagesMessage",
    "type": "object",
    "properties": {
        "type": "getLiveFeedSignedMessages",
        "feedId": {"$ref": "/FeedId"}, // todo
        "subfeedName": {"$ref": "/SubfeedName"}, // todo
        "position": {"type": "number"},
        "waitMsec": {"type": "number"}
    }
}

const submitMessagesToLiveFeedMessage = {
    "id": "/SubmitMessagesToLiveFeedMessage",
    "type": "object",
    "properties": {
        "type": "submitMessagesToLiveFeed",
        "feedId": {"$ref": "/FeedId"}, // todo
        "subfeedName": {"$ref": "/SubfeedName"}, // todo
        "messages": {
            "type": "array",
            "item": {"$ref", "/SubfeedMessage"} // todo
        }
    }
}