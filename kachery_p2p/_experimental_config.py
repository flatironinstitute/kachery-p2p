from typing import Union, List

_global_config = {
    'nop2p': False,
    'file_server_urls': []
}

def _experimental_config(*, nop2p: Union[None, bool]=None, file_server_urls: Union[None, List[str]]=None):
    if nop2p is not None:
        assert isinstance(nop2p, bool)
        _global_config['nop2p'] = nop2p
    if file_server_urls is not None:
        assert isinstance(file_server_urls, list)
        _global_config['file_server_urls'] = file_server_urls