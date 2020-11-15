import assert from 'assert'
import { randomAlphaString } from "../common/util"
import { protocolVersion } from "../protocolVersion"
import { isPacketId, PacketId } from '../udp/UdpPacketSender'
import { ByteCount, ChannelInfo, ChannelName, ChannelNodeInfo, DurationMsec, ErrorMessage, FeedId, FileKey, isArrayOf, isBoolean, isByteCount, isChannelInfo, isChannelName, isChannelNodeInfo, isDurationMsec, isEqualTo, isErrorMessage, isFeedId, isFileKey, isLiveFeedSubscriptions, isMessageCount, isNodeId, isNull, isOneOf, isRequestId, isSignature, isSignedSubfeedMessage, isString, isSubfeedHash, isSubfeedPosition, isSubmittedSubfeedMessage, isTimestamp, LiveFeedSubscriptions, MessageCount, NodeId, ProtocolVersion, RequestId, Signature, SignedSubfeedMessage, SubfeedHash, SubfeedPosition, SubmittedSubfeedMessage, Timestamp, _validateObject } from "./core"

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
        channelName: ChannelName,
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
        channelName: isChannelName,
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
    ReportSubfeedMessagesRequestData |
    SetLiveFeedSubscriptionsRequestData |
    SubmitMessageToLiveFeedRequestData |
    GetLiveFeedSignedMessagesRequestData |
    DownloadFileDataRequestData |
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
        isReportSubfeedMessagesResponseData,
        isSetLiveFeedSubscriptionsRequestData,
        isSubmitMessageToLiveFeedRequestData,
        isGetLiveFeedSignedMessagesRequestData,
        isDownloadFileDataRequestData,
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
    ReportSubfeedMessagesResponseData |
    SetLiveFeedSubscriptionsResponseData |
    SubmitMessageToLiveFeedResponseData |
    GetLiveFeedSignedMessagesResponseData |
    DownloadFileDataResponseData |
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
        isReportSubfeedMessagesResponseData,
        isSetLiveFeedSubscriptionsResponseData,
        isSubmitMessageToLiveFeedResponseData,
        isGetLiveFeedSignedMessagesResponseData,
        isDownloadFileDataResponseData,
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
    subfeedHash: SubfeedHash,
    position: SubfeedPosition,
    durationMsec: DurationMsec
}
export const isSubscribeToSubfeedRequestData = (x: any): x is SubscribeToSubfeedRequestData => {
    return _validateObject(x, {
        requestType: isEqualTo('subscribeToSubfeed'),
        feedId: isFeedId,
        subfeedHash: isSubfeedHash,
        position: isSubfeedPosition,
        durationMsec: isDurationMsec
    })
}
export interface SubscribeToSubfeedResponseData {
    requestType: 'subscribeToSubfeed',
    success: boolean,
    initialSignedMessages: SignedSubfeedMessage[] | null,
    errorMessage: ErrorMessage | null
}
export const isSubscribeToSubfeedResponseData = (x: any): x is SubscribeToSubfeedResponseData => {
    return _validateObject(x, {
        requestType: isEqualTo('subscribeToSubfeed'),
        success: isBoolean,
        initialSignedMessages: isOneOf([isArrayOf(isSignedSubfeedMessage), isNull]),
        errorMessage: isOneOf([isErrorMessage, isNull])
    })
}

// reportSubfeedMessages
export interface ReportSubfeedMessagesRequestData {
    requestType: 'reportSubfeedMessages',
    feedId: FeedId,
    subfeedHash: SubfeedHash,
    position: SubfeedPosition,
    signedMessages: SignedSubfeedMessage[]
}
export const isReportSubfeedMessagesRequestData = (x: any): x is ReportSubfeedMessagesRequestData => {
    return _validateObject(x, {
        requestType: isEqualTo('reportSubfeedMessages'),
        feedId: isFeedId,
        subfeedHash: isSubfeedHash,
        position: isSubfeedPosition,
        signedMessages: isArrayOf(isSignedSubfeedMessage)
    })
}
export interface ReportSubfeedMessagesResponseData {
    requestType: 'reportSubfeedMessages',
    success: boolean,
    errorMessage: ErrorMessage | null
}
export const isReportSubfeedMessagesResponseData = (x: any): x is ReportSubfeedMessagesResponseData => {
    return _validateObject(x, {
        requestType: isEqualTo('reportSubfeedMessages'),
        success: isBoolean,
        errorMessage: isOneOf([isErrorMessage, isNull])
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
    position: SubfeedPosition,
    maxNumMessages: MessageCount,
    waitMsec: DurationMsec
}
export const isGetLiveFeedSignedMessagesRequestData = (x: any): x is GetLiveFeedSignedMessagesRequestData => {
    return _validateObject(x, {
        requestType: isEqualTo('getLiveFeedSignedMessages'),
        feedId: isFeedId,
        subfeedHash: isSubfeedHash,
        position: isSubfeedPosition,
        maxNumMessages: isMessageCount,
        waitMsec: isDurationMsec
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
        signedMessages: isOneOf([isNull, isArrayOf(isSignedSubfeedMessage)]),
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