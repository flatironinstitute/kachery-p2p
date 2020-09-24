import axios from 'axios'
import { Address } from './interfaces/core';

// todo: type the path as UrlPath
export const httpPostJson = async (address: Address, path: string, data: Object, opts: {timeoutMsec: number}): Promise<Object> => {
    const res = await axios.post('http://' + address.hostName + ':' + address.port + path, data, {timeout: opts.timeoutMsec});
    return JSON.parse(res.data);
}