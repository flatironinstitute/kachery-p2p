import { protocolVersion } from "../protocolVersion"
import { ChannelName, isChannelName, isNodeId, isRequestId, NodeId, RequestId, Timestamp, _validateObject, isTimestamp, isOneOf, isEqualTo, ChannelNodeInfo, isChannelNodeInfo, FileKey, isFileKey, FeedId, isFeedId, LiveFeedSubscriptions, isLiveFeedSubscriptions, optional, isBoolean, isNumber, ChannelInfo, isChannelInfo, Signature, SubfeedHash, isSubfeedHash, isNull, SubmittedSubfeedMessage, isSubmittedSubfeedMessage, ErrorMessage, isErrorMessage, isBigInt, SignedSubfeedMessage, isArrayOf, isSignedSubfeedMessage, ProtocolVersion, isString } from "./core"
import assert from 'assert'
import { randomAlphaString } from "../common/util"

export const _tests: {[key: string]: () => void} = {}

// StreamId
export interface StreamId extends String {
    __streamId__: never // phantom type
}
export const isStreamId = (x: any): x is StreamId => {
    if (!isString(x)) return false;
    return (/^[A-Za-z]{10}$/.test(x))
}
export const createStreamId = () => {
    return randomAlphaString(10) as any as StreamId
}
_tests.StreamId = () => { assert(isStreamId(createStreamId())) }


export interface NodeToNodeRequest {
    body: {
        protocolVersion: ProtocolVersion,
        requestId: RequestId,
        fromNodeId: NodeId,
        toNodeId: NodeId,
        timestamp: Timestamp,
        requestData: NodeToNodeRequestData,
    },
    signature: Signature
}
export const isNodeToNodeRequest = (x: any): x is NodeToNodeRequest => {
    return _validateObject(x, {
        protocolVersion: isEqualTo(protocolVersion()),
        requestId: isRequestId,
        fromNodeId: isNodeId,
        toNodeId: isNodeId,
        timestamp: isTimestamp,
        requestData: isNodeToNodeRequestData
    })
}
export interface NodeToNodeResponse {
    body: {
        protocolVersion: ProtocolVersion,
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
        protocolVersion: isEqualTo(protocolVersion()),
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
    GetLiveFeedSignedMessagesRequestData |
    DownloadFileDataRequestData
)
export const isNodeToNodeRequestData = (x: any): x is NodeToNodeRequestData => {
    return isOneOf([
        isGetChannelInfoRequestData,
        isAnnounceRequestData,
        isCheckForFileRequestData,
        isCheckForLiveFeedRequestData,
        isSetLiveFeedSubscriptionsRequestData,
        isSubmitMessageToLiveFeedRequestData,
        isGetLiveFeedSignedMessagesRequestData,
        isDownloadFileDataRequestData
    ]) ? true : false;
}
export type NodeToNodeResponseData = (
    GetChannelInfoResponseData |
    AnnounceResponseData |
    CheckForFileResponseData |
    CheckForLiveFeedResponseData |
    SetLiveFeedSubscriptionsResponseData |
    SubmitMessageToLiveFeedResponseData |
    GetLiveFeedSignedMessagesResponseData |
    DownloadFileDataResponseData
)
export const isNodeToNodeResponseData = (x: any): x is NodeToNodeResponseData => {
    return isOneOf([
        isGetChannelInfoResponseData,
        isAnnounceResponseData,
        isCheckForFileResponseData,
        isCheckForLiveFeedResponseData,
        isSetLiveFeedSubscriptionsResponseData,
        isSubmitMessageToLiveFeedResponseData,
        isGetLiveFeedSignedMessagesResponseData,
        isDownloadFileDataResponseData
    ]) ? true : false;
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
    requestType: 'announce',
    success: boolean,
    errorMessage: ErrorMessage | null
}
export const isAnnounceResponseData = (x: any): x is AnnounceResponseData => {
    return _validateObject(x, {
        requestType: isEqualTo('announce'),
        success: isBoolean,
        errorMessage: isErrorMessage
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

// getLiveFeedSignedMessages
export interface GetLiveFeedSignedMessagesRequestData {
    requestType: 'getLiveFeedSignedMessages',
    feedId: FeedId,
    subfeedHash: SubfeedHash,
    position: number,
    maxNumMessages: number,
    waitMsec: number
}
export const isGetLiveFeedSignedMessagesRequestData = (x: any): x is GetLiveFeedSignedMessagesRequestData => {
    return _validateObject(x, {
        requestType: isEqualTo('getLiveFeedSignedMessages'),
        feedId: isFeedId,
        subfeedHash: isSubfeedHash,
        position: isNumber,
        maxNumMessages: isNumber,
        waitMsec: isNumber
    })
}
export interface GetLiveFeedSignedMessagesResponseData {
    requestType: 'getLiveFeedSignedMessages',
    success: boolean,
    signedMessages: SignedSubfeedMessage[] | null,
    errorMessage: ErrorMessage | null
}
export const isGetLiveFeedSignedMessagesResponseData = (x: any): x is GetLiveFeedSignedMessagesResponseData => {
    return _validateObject(x, {
        requestType: isEqualTo('getLiveFeedSignedMessages'),
        success: isBoolean,
        signedMessages: isArrayOf(isSignedSubfeedMessage),
        errorMessage: isOneOf([isNull, isErrorMessage])
    })
}

// downloadFileData
export interface DownloadFileDataRequestData {
    requestType: 'downloadFileData',
    fileKey: FileKey,
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
export interface DownloadFileDataResponseData {
    requestType: 'downloadFileData',
    success: boolean,
    streamId: StreamId | null,
    errorMessage: ErrorMessage | null
}
export const isDownloadFileDataResponseData = (x: any): x is DownloadFileDataResponseData => {
    return _validateObject(x, {
        requestType: isEqualTo('downloadFileData'),
        success: isBoolean,
        streamId: isOneOf([isNull, isStreamId]),
        errorMessage: isOneOf([isNull, isErrorMessage])
    })
}