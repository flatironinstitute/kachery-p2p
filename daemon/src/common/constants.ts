import { maxDuration, scaledDurationMsec, unscaledDurationMsec } from "../interfaces/core";

const _d = (a: number, b: number) => {
    return maxDuration(scaledDurationMsec(a), unscaledDurationMsec(b))
}

export const TIMEOUTS = {
    loadFileFindFile: _d(4000, 1000),
    defaultRequest: _d(5000, 1000),
    defaultResponse: _d(5000, 1000),
    websocketConnect: _d(3000, 1000),
    fallbackUdpPacket: _d(4000, 1000)
}

