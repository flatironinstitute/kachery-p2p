import os
import time
import tempfile
from typing import List, Union, cast
from ._misc import _http_get_json

def _api_port():
    return os.getenv('KACHERY_P2P_API_PORT', 20431)

def _api_host():
    return os.getenv('KACHERY_P2P_API_HOST', 'localhost')

def _api_url(api_port=None, api_host=None):
    if api_port is not None:
        port = api_port
    else:
        port = _api_port()
    if api_host is not None:
        host = api_host
    else:
        host = _api_host()
    return f'http://{host}:{port}'

class _probe_result:
    def __init__(self, x: dict):
        self.probe_response = cast(dict, x)
        self.node_id = cast(str, x['nodeId'])
        self.joined_channels = cast(List[dict], x['joinedChannels'])
        self.kachery_storage_dir = cast(Union[str, None], x['kacheryStorageDir'] or None)
        ksd = os.getenv('KACHERY_STORAGE_DIR', None) 
        if ksd is not None:
            if ksd != self.kachery_storage_dir:
                raise Exception(f'KACHERY_STORAGE_DIR is set, but is inconsistent with the daemon: {ksd} <> {self.kachery_storage_dir}')

class _buffered_probe_data:
    timestamp: float=0
    result: Union[None, _probe_result]=None

def _buffered_probe_daemon(api_port=None):
    elapsed_since_last = time.time() - _buffered_probe_data.timestamp
    if elapsed_since_last <= 10:
        return _buffered_probe_data.result
    res = _probe_daemon(api_port=api_port)
    _buffered_probe_data.timestamp = time.time()
    _buffered_probe_data.result = res
    return _buffered_probe_data.result

def _probe_daemon(api_port=None):
    api_url = _api_url(api_port=api_port)
    url = f'{api_url}/probe'
    try:
        x = _http_get_json(url)
    except Exception as e:
        return None
    res = _probe_result(x) if x is not None else None
    return res

def _kachery_offline_storage_dir_env_is_set():
    return os.getenv('KACHERY_OFFLINE_STORAGE_DIR', None) is not None

def _kachery_storage_dir():
    if _kachery_offline_storage_dir_env_is_set():
        return os.getenv('KACHERY_OFFLINE_STORAGE_DIR', None)
    else:
        p = _buffered_probe_daemon()
        if p is not None:
            return p.kachery_storage_dir
        else:
            return None

def _create_if_needed(dirpath: str) -> str:
    if not os.path.isdir(dirpath):
        os.mkdir(dirpath)
    return dirpath

def _kachery_temp_dir() -> str:
    d = os.getenv('KACHERY_TEMP_DIR', None)
    if d is not None:
        return _create_if_needed(d)
    if _kachery_offline_storage_dir_env_is_set():
        return _create_if_needed(os.getenv('KACHERY_OFFLINE_STORAGE_DIR') + '/kachery-tmp')
    else:
        return _create_if_needed(tempfile.gettempdir() + '/kachery-tmp')

def _is_offline_mode():
    return _kachery_offline_storage_dir_env_is_set()
        
def _is_online_mode():
    if _is_offline_mode():
        return False
    return _kachery_storage_dir() is not None