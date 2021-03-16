import os
from typing import Union
import simplejson
import numpy as np
from ._daemon_connection import _is_offline_mode, _is_online_mode, _kachery_storage_dir, _api_url
from ._local_kachery_storage import _local_kachery_storage_store_file
from ._misc import _http_post_json
from ._temporarydirectory import TemporaryDirectory

def _store_file(path: str, basename: Union[str, None]=None) -> str:
    if basename is None:
        basename = os.path.basename(path)
    if _is_offline_mode():
        stored_path, hash0 = _local_kachery_storage_store_file(path=path, use_hard_links=False, _known_hash=None)
        return f'sha1://{hash0}/{basename}'
    if not _is_online_mode():
        raise Exception('Not connected to daemon and not in offline mode.')
    url = f'{_api_url()}/storeFile'
    resp = _http_post_json(url, {'localFilePath': os.path.abspath(path)})
    if not resp['success']:
        raise Exception(f'Problem storing file: {resp["error"]}')
    sha1 = resp['sha1']
    return f'sha1://{sha1}/{basename}'

def _store_text(text: str, basename: Union[str, None]=None) -> str:
    if basename is None:
        basename = 'file.txt'
    with TemporaryDirectory() as tmpdir:
        fname = tmpdir + '/text.txt'
        with open(fname, 'w') as f:
            f.write(text)
        return _store_file(fname, basename=basename)

def _store_object(object: dict, basename: Union[str, None]=None) -> str:
    if basename is None:
        basename = 'file.json'
    txt = simplejson.dumps(object, indent=None)
    return _store_text(text=txt, basename=basename)

def _store_npy(array: np.ndarray, basename: Union[str, None]=None) -> str:
    if basename is None:
        basename = 'file.npy'
    with TemporaryDirectory() as tmpdir:
        fname = tmpdir + '/array.npy'
        np.save(fname, array)
        return _store_file(fname, basename=basename)