import assert from 'assert'
import { randomAlphaString } from "../common/util"
import { protocolVersion } from "../protocolVersion"
import { isPacketId, PacketId } from '../udp/UdpPacketSender'
import { ByteCount, ChannelConfigUrl, ChannelInfo, ChannelNodeInfo, DurationMsec, ErrorMessage, FeedId, FileKey, isBoolean, isByteCount, isChannelConfigUrl, isChannelInfo, isChannelNodeInfo, isDurationMsec, isEqualTo, isErrorMessage, isFeedId, isFileKey, isMessageCount, isNodeId, isNull, isOneOf, isRequestId, isSignature, isString, isSubfeedHash, isSubfeedPosition, isSubmittedSubfeedMessage, isTimestamp, MessageCount, NodeId, ProtocolVersion, RequestId, Signature, SubfeedHash, SubfeedPosition, SubmittedSubfeedMessage, Timestamp, _validateObject } from "./core"

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
        timeoutMsec: DurationMsec
    },
    signature: Signature
}
export const isNodeToNodeRequestBody = (x: any): boolean => {
    return _validateObject(x, {
        protocolVersion: isEqualTo(protocolVersion()),
        requestId: isRequestId,
        fromNodeId: isNodeId,
        toNodeId: isNodeId,
        timestamp: isTimestamp,
        requestData: isNodeToNodeRequestData,
        timeoutMsec: isDurationMsec
    })
}
export const isNodeToNodeRequest = (x: any): x is NodeToNodeRequest => {
    return _validateObject(x, {
        body: isNodeToNodeRequestBody,
        signature: isSignature
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
export const isNodeToNodeResponseBody = (x: any): boolean => {
    return _validateObject(x, {
        protocolVersion: isEqualTo(protocolVersion()),
        requestId: isRequestId,
        fromNodeId: isNodeId,
        toNodeId: isNodeId,
        timestamp: isTimestamp,
        responseData: isNodeToNodeResponseData
    })
}
export const isNodeToNodeResponse = (x: any): x is NodeToNodeResponse => {
    return _validateObject(x, {
        body: isNodeToNodeResponseBody,
        signature: isSignature
    })
}

export type NodeToNodeRequestData = (
    CheckAliveRequestData |
    GetChannelInfoRequestData |
    AnnounceRequestData |
    CheckForFileRequestData |
    CheckForLiveFeedRequestData |
    SubscribeToSubfeedRequestData |
    ReportNewSubfeedMessagesRequestData |
    SubmitMessageToLiveFeedRequestData |
    DownloadFileDataRequestData |
    DownloadSubfeedMessagesRequestData |
    StartStreamViaUdpRequestData |
    StopStreamViaUdpRequestData |
    FallbackUdpPacketRequestData
)
export const isNodeToNodeRequestData = (x: any): x is NodeToNodeRequestData => {
    return isOneOf([
        isCheckAliveRequestData,
        isGetChannelInfoRequestData,
        isAnnounceRequestData,
        isCheckForFileRequestData,
        isCheckForLiveFeedRequestData,
        isSubscribeToSubfeedResponseData,
        isReportNewSubfeedMessagesResponseData,
        isSubmitMessageToLiveFeedRequestData,
        isDownloadFileDataRequestData,
        isDownloadSubfeedMessagesRequestData,
        isStartStreamViaUdpRequestData,
        isStopStreamViaUdpRequestData,
        isFallbackUdpPacketRequestData
    ]) ? true : false;
}
export type NodeToNodeResponseData = (
    CheckAliveResponseData |
    GetChannelInfoResponseData |
    AnnounceResponseData |
    CheckForFileResponseData |
    CheckForLiveFeedResponseData |
    SubscribeToSubfeedResponseData |
    ReportNewSubfeedMessagesResponseData |
    SubmitMessageToLiveFeedResponseData |
    DownloadFileDataResponseData |
    DownloadSubfeedMessagesResponseData |
    StartStreamViaUdpResponseData |
    StopStreamViaUdpResponseData |
    FallbackUdpPacketResponseData
)
export const isNodeToNodeResponseData = (x: any): x is NodeToNodeResponseData => {
    return isOneOf([
        isCheckAliveResponseData,
        isGetChannelInfoResponseData,
        isAnnounceResponseData,
        isCheckForFileResponseData,
        isCheckForLiveFeedResponseData,
        isSubscribeToSubfeedResponseData,
        isReportNewSubfeedMessagesResponseData,
        isSubmitMessageToLiveFeedResponseData,
        isDownloadFileDataResponseData,
        isDownloadSubfeedMessagesResponseData,
        isStartStreamViaUdpResponseData,
        isStopStreamViaUdpResponseData,
        isFallbackUdpPacketResponseData
    ]) ? true : false;
}

// // probe
// export interface ProbeRequestData {
//     requestType: 'probe'
// }
// export const isProbeRequestData = (x: any): x is ProbeRequestData => {
//     return _validateObject(x, {
//         requestType: isEqualTo('probe')
//     })
// }
// export interface ProbeResponseData {
//     requestType: 'probe',
//     probeResponse: ApiProbeResponse
// }
// export const isProbeResponseData = (x: any): x is ProbeResponseData => {
//     return _validateObject(x, {
//         requestType: isEqualTo('probe'),
//         probeResponse: isApiProbeResponse
//     })
// }

// CheckAliveRequestData
export interface CheckAliveRequestData {
    requestType: 'checkAlive'
}
export const isCheckAliveRequestData = (x: any): x is CheckAliveRequestData => {
    return _validateObject(x, {
        requestType: isEqualTo('checkAlive')
    })
}
export interface CheckAliveResponseData {
    requestType: 'checkAlive',
    alive: boolean
}
export const isCheckAliveResponseData = (x: any): x is CheckAliveResponseData => {
    return _validateObject(x, {
        requestType: isEqualTo('checkAlive'),
        alive: isBoolean
    })
}

// getChannelInfo
export interface GetChannelInfoRequestData {
    requestType: 'getChannelInfo'
    channelConfigUrl: ChannelConfigUrl
}
export const isGetChannelInfoRequestData = (x: any): x is GetChannelInfoRequestData => {
    return _validateObject(x, {
        requestType: isEqualTo('getChannelInfo'),
        channelConfigUrl: isChannelConfigUrl
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
        errorMessage: isOneOf([isNull, isErrorMessage])
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
    size: ByteCount | null
}
export const isCheckForFileResponseData = (x: any): x is CheckForFileResponseData => {
    return _validateObject(x, {
        requestType: isEqualTo('checkForFile'),
        found: isBoolean,
        size: isOneOf([isNull, isByteCount])
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
        found: isBoolean
    })
}

// subscribeToSubfeed
export interface SubscribeToSubfeedRequestData {
    requestType: 'subscribeToSubfeed',
    feedId: FeedId,
    subfeedHash: SubfeedHash
}
export const isSubscribeToSubfeedRequestData = (x: any): x is SubscribeToSubfeedRequestData => {
    return _validateObject(x, {
        requestType: isEqualTo('subscribeToSubfeed'),
        feedId: isFeedId,
        subfeedHash: isSubfeedHash
    })
}
export interface SubscribeToSubfeedResponseData {
    requestType: 'subscribeToSubfeed',
    success: boolean,
    numMessages: MessageCount | null,
    errorMessage: ErrorMessage | null
}
export const isSubscribeToSubfeedResponseData = (x: any): x is SubscribeToSubfeedResponseData => {
    return _validateObject(x, {
        requestType: isEqualTo('subscribeToSubfeed'),
        success: isBoolean,
        numMessages: isOneOf([isMessageCount, isNull]),
        errorMessage: isOneOf([isErrorMessage, isNull])
    })
}

// reportNewSubfeedMessages
export interface ReportNewSubfeedMessagesRequestData {
    requestType: 'reportNewSubfeedMessages',
    feedId: FeedId,
    subfeedHash: SubfeedHash,
    numMessages: MessageCount
}
export const isReportNewSubfeedMessagesRequestData = (x: any): x is ReportNewSubfeedMessagesRequestData => {
    return _validateObject(x, {
        requestType: isEqualTo('reportNewSubfeedMessages'),
        feedId: isFeedId,
        subfeedHash: isSubfeedHash,
        numMessages: isMessageCount
    })
}
export interface ReportNewSubfeedMessagesResponseData {
    requestType: 'reportNewSubfeedMessages',
    success: boolean,
    errorMessage: ErrorMessage | null
}
export const isReportNewSubfeedMessagesResponseData = (x: any): x is ReportNewSubfeedMessagesResponseData => {
    return _validateObject(x, {
        requestType: isEqualTo('reportNewSubfeedMessages'),
        success: isBoolean,
        errorMessage: isOneOf([isErrorMessage, isNull])
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
    fileKey: FileKey,
    startByte: ByteCount,
    endByte: ByteCount | null
}
export const isDownloadFileDataRequestData = (x: any): x is DownloadFileDataRequestData => {
    return _validateObject(x, {
        requestType: isEqualTo('downloadFileData'),
        fileKey: isFileKey,
        startByte: isByteCount,
        endByte: isOneOf([isNull, isByteCount])
    })
}
export interface DownloadFileDataResponseData {
    requestType: 'downloadFileData',
    fileKey: FileKey,
    startByte: ByteCount,
    endByte: ByteCount,
    success: boolean,
    streamId: StreamId | null,
    errorMessage: ErrorMessage | null
}
export const isDownloadFileDataResponseData = (x: any): x is DownloadFileDataResponseData => {
    return _validateObject(x, {
        requestType: isEqualTo('downloadFileData'),
        fileKey: isFileKey,
        startByte: isByteCount,
        endByte: isByteCount,
        success: isBoolean,
        streamId: isOneOf([isNull, isStreamId]),
        errorMessage: isOneOf([isNull, isErrorMessage])
    })
}

export interface DownloadSubfeedMessagesRequestData {
    requestType: 'downloadSubfeedMessages',
    feedId: FeedId,
    subfeedHash: SubfeedHash,
    position: SubfeedPosition,
    numMessages: MessageCount
}
export const isDownloadSubfeedMessagesRequestData = (x: any): x is DownloadSubfeedMessagesRequestData => {
    return _validateObject(x, {
        requestType: isEqualTo('downloadSubfeedMessages'),
        feedId: isFeedId,
        subfeedHash: isSubfeedHash,
        position: isSubfeedPosition,
        numMessages: isMessageCount
    })
}
export interface DownloadSubfeedMessagesResponseData {
    requestType: 'downloadSubfeedMessages',
    success: boolean,
    streamId: StreamId | null,
    errorMessage: ErrorMessage | null
}
export const isDownloadSubfeedMessagesResponseData = (x: any): x is DownloadSubfeedMessagesResponseData => {
    return _validateObject(x, {
        requestType: isEqualTo('downloadSubfeedMessages'),
        success: isBoolean,
        streamId: isOneOf([isNull, isStreamId]),
        errorMessage: isOneOf([isNull, isErrorMessage])
    })
}

export interface StartStreamViaUdpRequestData {
    requestType: 'startStreamViaUdp',
    streamId: StreamId
}
export const isStartStreamViaUdpRequestData = (x: any): x is DownloadFileDataRequestData => {
    return _validateObject(x, {
        requestType: isEqualTo('startStreamViaUdp'),
        streamId: isStreamId
    })
}
export interface StartStreamViaUdpResponseData {
    requestType: 'startStreamViaUdp',
    success: boolean,
    errorMessage: ErrorMessage | null
}
export const isStartStreamViaUdpResponseData = (x: any): x is DownloadFileDataResponseData => {
    return _validateObject(x, {
        requestType: isEqualTo('startStreamViaUdp'),
        success: isBoolean,
        errorMessage: isOneOf([isNull, isErrorMessage])
    })
}

export interface StopStreamViaUdpRequestData {
    requestType: 'stopStreamViaUdp',
    streamId: StreamId
}
export const isStopStreamViaUdpRequestData = (x: any): x is DownloadFileDataRequestData => {
    return _validateObject(x, {
        requestType: isEqualTo('stopStreamViaUdp'),
        streamId: isStreamId
    })
}
export interface StopStreamViaUdpResponseData {
    requestType: 'stopStreamViaUdp',
    success: boolean,
    errorMessage: ErrorMessage | null
}
export const isStopStreamViaUdpResponseData = (x: any): x is DownloadFileDataResponseData => {
    return _validateObject(x, {
        requestType: isEqualTo('stopStreamViaUdp'),
        success: isBoolean,
        errorMessage: isOneOf([isNull, isErrorMessage])
    })
}

export interface FallbackUdpPacketRequestData {
    requestType: 'fallbackUdpPacket',
    dataBase64: string,
    packetId: PacketId
}
export const isFallbackUdpPacketRequestData = (x: any): x is DownloadFileDataRequestData => {
    return _validateObject(x, {
        requestType: isEqualTo('fallbackUdpPacket'),
        dataBase64: isString,
        packetId: isPacketId
    })
}
export interface FallbackUdpPacketResponseData {
    requestType: 'fallbackUdpPacket',
    success: boolean,
    errorMessage: ErrorMessage | null
}
export const isFallbackUdpPacketResponseData = (x: any): x is DownloadFileDataResponseData => {
    return _validateObject(x, {
        requestType: isEqualTo('fallbackUdpPacket'),
        success: isBoolean,
        errorMessage: isOneOf([isNull, isErrorMessage])
    })
}