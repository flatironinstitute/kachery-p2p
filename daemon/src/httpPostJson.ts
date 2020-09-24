import axios from 'axios'
import { Address } from './interfaces/core';

export const httpPostJson = async (address: Address, data: Object): Promise<Object> => {
    const res = await axios.post('http://' + address.hostName + ':' + address.port, data);
    return JSON.parse(res.data);
}