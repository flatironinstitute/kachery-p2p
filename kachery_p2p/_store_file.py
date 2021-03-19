import os
from typing import Any, Union
import simplejson
import numpy as np
import stat
from ._daemon_connection import _is_offline_mode, _is_online_mode, _kachery_storage_dir, _api_url
from ._local_kachery_storage import _local_kachery_storage_store_file
from ._misc import _http_post_json
from ._temporarydirectory import TemporaryDirectory
from ._safe_pickle import _safe_pickle, _safe_unpickle

def _store_file(path: str, basename: Union[str, None]=None) -> str:
    if basename is None:
        basename = os.path.basename(path)
    if _is_offline_mode():
        stored_path, hash0, manifest_hash = _local_kachery_storage_store_file(path=path, use_hard_links=False)
        if manifest_hash is None:
            return f'sha1://{hash0}/{basename}'
        else:
            return f'sha1://{hash0}/{basename}?manifest={manifest_hash}'
    if not _is_online_mode():
        raise Exception('Not connected to daemon and not in offline mode.')
    url = f'{_api_url()}/storeFile'
    resp = _http_post_json(url, {'localFilePath': os.path.abspath(path)})
    if not resp['success']:
        raise Exception(f'Problem storing file: {resp["error"]}')
    sha1 = resp['sha1']
    manifest_sha1 = resp['manifestSha1']
    if manifest_sha1:
        return f'sha1://{sha1}/{basename}?manifest={manifest_sha1}'
    else:
        return f'sha1://{sha1}/{basename}'

def _add_read_permissions(fname: str):
    st = os.stat(fname)
    os.chmod(fname, st.st_mode | stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)

def _add_exec_permissions(fname: str):
    st = os.stat(fname)
    os.chmod(fname, st.st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

def _store_text(text: str, basename: Union[str, None]=None) -> str:
    if basename is None:
        basename = 'file.txt'
    with TemporaryDirectory() as tmpdir:
        fname = tmpdir + '/text.txt'
        with open(fname, 'w') as f:
            f.write(text)
        _add_read_permissions(tmpdir)
        _add_exec_permissions(tmpdir)
        _add_read_permissions(fname)
        return _store_file(fname, basename=basename)

def _store_json(object: dict, basename: Union[str, None]=None, separators=(',', ':'), indent=None) -> str:
    if basename is None:
        basename = 'file.json'
    txt = simplejson.dumps(object, separators=separators, indent=indent)
    return _store_text(text=txt, basename=basename)

def _store_npy(array: np.ndarray, basename: Union[str, None]=None) -> str:
    if basename is None:
        basename = 'file.npy'
    with TemporaryDirectory() as tmpdir:
        fname = tmpdir + '/array.npy'
        np.save(fname, array, allow_pickle=False)
        _add_read_permissions(tmpdir)
        _add_exec_permissions(tmpdir)
        _add_read_permissions(fname)
        return _store_file(fname, basename=basename)

def _store_pkl(x: Any, basename: Union[str, None]=None) -> str:
    if basename is None:
        basename = 'file.pkl'
    with TemporaryDirectory() as tmpdir:
        fname = tmpdir + '/array.pkl'
        _safe_pickle(fname, x)
        _add_read_permissions(tmpdir)
        _add_exec_permissions(tmpdir)
        _add_read_permissions(fname)
        return _store_file(fname, basename=basename)