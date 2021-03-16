from ._daemon_connection import _api_url, _buffered_probe_daemon, _probe_daemon
from typing import Dict, Iterable, List, Optional, Tuple, Union, cast
from ._load_file import _resolve_file_uri_from_dir_uri
from ._misc import _parse_kachery_uri, _http_post_json_receive_json_socket, _http_get_json, _create_file_key
from ._experimental_config import _global_config

def _find_file(uri: str, timeout_sec: float) -> Iterable[dict]:
    if uri.startswith('sha1dir://'):
        uri_resolved = _resolve_file_uri_from_dir_uri(uri)
        if uri_resolved is None:
            raise Exception('Unable to find file.')
        uri = uri_resolved
    if _global_config['nop2p']:
        return cast(Iterable[dict], _empty_iterator())
    api_url = _api_url()
    url = f'{api_url}/findFile'
    protocol, algorithm, hash0, additional_path, query = _parse_kachery_uri(uri)
    assert algorithm == 'sha1'
    file_key = _create_file_key(sha1=hash0, query=query)
    return _http_post_json_receive_json_socket(url, dict(fileKey=file_key, timeoutMsec=timeout_sec * 1000))

def _get_channels(api_port=None) -> List[dict]:
    x = _probe_daemon(api_port=api_port)
    assert x is not None, 'Unable to connect to daemon.'
    return x.joined_channels

def _get_node_id(api_port=None) -> str:
    x = _buffered_probe_daemon(api_port=api_port)
    assert x is not None, 'Unable to connect to daemon.'
    return x.node_id

class _empty_iterator:
    def __init__(self):
        pass

    def __iter__(self):
        return self

    def __next__(self):
        raise StopIteration

