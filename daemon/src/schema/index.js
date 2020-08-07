import validator from './validator.js';

export const validateObject = (obj, schemaId) => {
    try {
        validator.validate(obj, {'$ref': schemaId}, {throwError: true});
    }
    catch(err) {
        console.warn(err);
        console.warn(JSON.stringify(obj, null, 4));
        throw Error(`Validation error for ${schemaId}: ${err.message}`)
    }
}

export const validateChannelName = (name) => {
    validateObject(name, '/ChannelName');
}

export const validateNodeId = (nodeId) => {
    validateObject(nodeId, '/NodeId');
}

export const validateSha1Hash = (sha1) => {
    validateObject(sha1, '/Sha1Hash');
}

export const validateNodeToNodeMessage = (message) => {
    validateObject(message, '/NodeToNodeMessage');
}

export const validateNodeData = (data) => {
    validateObject(data, '/NodeData');
}