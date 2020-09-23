import { ChannelName, isChannelName, isNodeId, isRequestId, NodeId, RequestId, Timestamp, _validateObject, isTimestamp, isOneOf, isEqualTo, ChannelNodeInfo, isChannelNodeInfo, FileKey, isFileKey, FeedId, isFeedId, LiveFeedSubscriptions, isLiveFeedSubscriptions, optional, isBoolean, isNumber, ChannelInfo, isChannelInfo, Signature, SubfeedHash, isSubfeedHash, isNull, SubmittedSubfeedMessage, isSubmittedSubfeedMessage, ErrorMessage, isErrorMessage, isBigInt } from "./core"

export interface NodeToNodeRequest {
    body: {
        requestId: RequestId,
        fromNodeId: NodeId,
        toNodeId: NodeId,
        timestamp: Timestamp,
        requestData: NodeToNodeRequestData
    },
    signature: Signature
}
export const isNodeToNodeRequest = (x: any): x is NodeToNodeRequest => {
    return _validateObject(x, {
        requestId: isRequestId,
        fromNodeId: isNodeId,
        toNodeId: isNodeId,
        timestamp: isTimestamp,
        requestData: isNodeToNodeRequestData
    })
}
export interface NodeToNodeResponse {
    body: {
        requestId: RequestId,
        fromNodeId: NodeId,
        toNodeId: NodeId,
        timestamp: Timestamp,
        responseData: NodeToNodeResponseData
    },
    signature: Signature
}
export const isNodeToNodeResponse = (x: any): x is NodeToNodeResponse => {
    return _validateObject(x, {
        requestId: isRequestId,
        fromNodeId: isNodeId,
        toNodeId: isNodeId,
        timestamp: isTimestamp,
        responseData: isNodeToNodeResponseData
    })
}

export type NodeToNodeRequestData = (
    GetChannelInfoRequestData |
    AnnounceRequestData |
    CheckForFileRequestData |
    CheckForLiveFeedRequestData |
    SetLiveFeedSubscriptionsRequestData |
    SubmitMessageToLiveFeedRequestData |
    DownloadFileDataRequestData
)
export const isNodeToNodeRequestData = (x: any): x is NodeToNodeRequestData => {
    return isOneOf([
        isGetChannelInfoRequestData,
        isAnnounceRequestData,
        isCheckForFileRequestData,
        isCheckForLiveFeedRequestData,
        isSetLiveFeedSubscriptionsRequestData
    ]) ? true : false;
}
export type NodeToNodeResponseData = (
    GetChannelInfoResponseData |
    AnnounceResponseData |
    CheckForFileResponseData |
    CheckForLiveFeedResponseData |
    SetLiveFeedSubscriptionsResponseData |
    SubmitMessageToLiveFeedResponseData
)
export const isNodeToNodeResponseData = (x: any): x is NodeToNodeResponseData => {
    return isOneOf([
        isGetChannelInfoResponseData,
        isAnnounceResponseData,
        isCheckForFileResponseData,
        isCheckForLiveFeedResponseData,
        isSetLiveFeedSubscriptionsResponseData
    ]) ? true : false;
}
export const isDownloadRequest = (x: NodeToNodeRequestData) => {
    return ['downloadFileData'].includes(x.requestType);
}

// getChannelInfo
export interface GetChannelInfoRequestData {
    requestType: 'getChannelInfo',
    channelName: ChannelName
}
export const isGetChannelInfoRequestData = (x: any): x is GetChannelInfoRequestData => {
    return _validateObject(x, {
        requestType: isEqualTo('getChannelInfo'),
        channelName: isChannelName
    })
}
export interface GetChannelInfoResponseData {
    requestType: 'getChannelInfo',
    channelInfo: ChannelInfo
}
export const isGetChannelInfoResponseData = (x: any): x is GetChannelInfoResponseData => {
    return _validateObject(x, {
        requestType: isEqualTo('getChannelInfo'),
        channelInfo: isChannelInfo
    })
}

// announce
export interface AnnounceRequestData {
    requestType: 'announce',
    channelNodeInfo: ChannelNodeInfo
}
export const isAnnounceRequestData = (x: any): x is AnnounceRequestData => {
    return _validateObject(x, {
        requestType: isEqualTo('announce'),
        channelNodeInfo: isChannelNodeInfo
    })
}
export interface AnnounceResponseData {
    requestType: 'announce'
}
export const isAnnounceResponseData = (x: any): x is AnnounceResponseData => {
    return _validateObject(x, {
        requestType: isEqualTo('announce')
    })
}

// checkForFile
export interface CheckForFileRequestData {
    requestType: 'checkForFile',
    fileKey: FileKey
}
export const isCheckForFileRequestData = (x: any): x is CheckForFileRequestData => {
    return _validateObject(x, {
        requestType: isEqualTo('checkForFile'),
        fileKey: isFileKey
    })
}
export interface CheckForFileResponseData {
    requestType: 'checkForFile',
    found: boolean,
    size: bigint | null
}
export const isCheckForFileResponseData = (x: any): x is CheckForFileResponseData => {
    return _validateObject(x, {
        requestType: isEqualTo('checkForFile'),
        found: isBoolean,
        size: isOneOf([isNull, isBigInt])
    })
}

// checkForLiveFeed
export interface CheckForLiveFeedRequestData {
    requestType: 'checkForLiveFeed',
    feedId: FeedId
}
export const isCheckForLiveFeedRequestData = (x: any): x is CheckForLiveFeedRequestData => {
    return _validateObject(x, {
        requestType: isEqualTo('checkForLiveFeed'),
        feedId: isFeedId
    })
}
export interface CheckForLiveFeedResponseData {
    requestType: 'checkForLiveFeed',
    found: boolean
}
export const isCheckForLiveFeedResponseData = (x: any): x is CheckForLiveFeedResponseData => {
    return _validateObject(x, {
        requestType: isEqualTo('checkForLiveFeed'),
        found: isBoolean,
        numMessages: optional(isNumber)
    })
}

// setLiveFeedSubscriptions
export interface SetLiveFeedSubscriptionsRequestData {
    requestType: 'setLiveFeedSubscriptions',
    liveFeedSubscriptions: LiveFeedSubscriptions
}
export const isSetLiveFeedSubscriptionsRequestData = (x: any): x is SetLiveFeedSubscriptionsRequestData => {
    return _validateObject(x, {
        requestType: isEqualTo('setLiveFeedSubscriptions'),
        liveFeedSubscriptions: isLiveFeedSubscriptions
    })
}
export interface SetLiveFeedSubscriptionsResponseData {
    requestType: 'setLiveFeedSubscriptions',
    success: boolean
}
export const isSetLiveFeedSubscriptionsResponseData = (x: any): x is SetLiveFeedSubscriptionsResponseData => {
    return _validateObject(x, {
        requestType: isEqualTo('setLiveFeedSubscriptions'),
        success: isBoolean
    })
}

// submitMessageToLiveFeed
export interface SubmitMessageToLiveFeedRequestData {
    requestType: 'submitMessageToLiveFeed',
    feedId: FeedId,
    subfeedHash: SubfeedHash,
    message: SubmittedSubfeedMessage
}
export const isSubmitMessageToLiveFeedRequestData = (x: any): x is SubmitMessageToLiveFeedRequestData => {
    return _validateObject(x, {
        requestType: isEqualTo('submitMessageToLiveFeed'),
        feedId: isFeedId,
        subfeedHash: isSubfeedHash,
        message: isSubmittedSubfeedMessage
    })
}
export interface SubmitMessageToLiveFeedResponseData {
    requestType: 'submitMessageToLiveFeed',
    success: boolean,
    errorMessage: ErrorMessage | null
}
export const isSubmitMessageToLiveFeedResponseData = (x: any): x is SubmitMessageToLiveFeedResponseData => {
    return _validateObject(x, {
        requestType: isEqualTo('submitMessageToLiveFeed'),
        success: isBoolean,
        errorMessage: isOneOf([isNull, isErrorMessage])
    })
}

// downloadFileData
export interface DownloadFileDataRequestData {
    requestType: 'downloadFileData',
    fileKey,
    startByte: bigint,
    endByte: bigint
}
export const isDownloadFileDataRequestData = (x: any): x is DownloadFileDataRequestData => {
    return _validateObject(x, {
        requestType: isEqualTo('downloadFileData'),
        fileKey: isFileKey,
        startByte: isBigInt,
        endByte: isBigInt
    })
}