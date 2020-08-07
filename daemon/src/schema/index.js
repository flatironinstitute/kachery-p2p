import validator from './validator.js';

export const validateObject = (obj, schemaId, opts) => {
    opts = opts || {};
    try {
        validator.validate(obj, {'$ref': schemaId}, {throwError: true});
    }
    catch(err) {
        if (opts.noThrow) {
            return false;
        }
        console.warn(`Validation error: ${err.message}`);
        console.warn(JSON.stringify(obj, null, 4));
        throw Error(`Validation error for ${schemaId}: ${err.message}`)
    }
    return true;
}

export const validateChannelName = (name, opts) => {
    validateObject(name, '/ChannelName', opts || {});
}

export const validateNodeId = (nodeId, opts) => {
    validateObject(nodeId, '/NodeId', opts || {});
}

export const validateSha1Hash = (sha1, opts) => {
    validateObject(sha1, '/Sha1Hash', opts || {});
}

export const validateNodeToNodeMessage = (message, opts) => {
    validateObject(message, '/NodeToNodeMessage', opts || {});
}

export const validateNodeData = (data, opts) => {
    validateObject(data, '/NodeData', opts || {});
}

export const validatePort = (port, opts) => {
    validateObject(port, '/Port', opts || {});
}