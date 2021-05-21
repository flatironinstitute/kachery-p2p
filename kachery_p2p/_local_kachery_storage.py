import os
import sys
import hashlib
import shutil
import random
import json
from typing import Optional, Tuple, Union
from ._misc import _parse_kachery_uri
from ._daemon_connection import _kachery_storage_dir


def _local_kachery_storage_load_file(*, sha1_hash: str):
    sha1_directory = f'{_kachery_storage_dir()}/sha1'
    path = _get_path_ext(hash=sha1_hash, create=False, directory=sha1_directory)
    if os.path.exists(path):
        return path
    elif os.path.exists(path + '.link'):
        linked_file_path = _find_linked_file(path + '.link')
        if linked_file_path is not None:
            return linked_file_path
    return None

def _find_linked_file(link_path: str):
    with open(link_path, 'r') as f:
        link: dict = json.load(f)
    path = link.get('path', None)
    if path is None:
        print(f'WARNING: problem with link (no path field): {link_path}')
        return None
    stat = link.get('stat', None)
    if stat is None:
        print(f'WARNING: problem with link (no stat field): {link_path}')
        return None
    if os.path.exists(path):
        if _stat_matches(stat, path):
            return path
        else:
            print(f'WARNING: linked file may have been modified: {link_path} {path}')
            return None
    else:
        print('WARNING: linked file does not exist: {link_path} {path}')
    return None

def _stat_matches(stat: dict, path: str):
    s = os.stat(path)
    if stat['size'] != s.st_size:
        return False
    if stat['mtime'] != s.st_mtime:
        return False
    return True
    
def _local_kachery_storage_load_bytes(*, sha1_hash: str, start: Union[int, None]=None, end: Union[int, None]=None, write_to_stdout: bool=False):
    sha1_directory = f'{_kachery_storage_dir()}/sha1'
    path = _get_path_ext(hash=sha1_hash, create=False, directory=sha1_directory)
    if os.path.exists(path):
        return _load_bytes_from_local_file(local_fname=path, start=start, end=end, write_to_stdout=write_to_stdout)
    else:
        return None

def _local_kachery_storage_store_file(*, path: str, _no_manifest=False) -> Tuple[str, str, Union[str, None]]:
    from ._store_file import _store_json # don't want circular dependencies
    if (not _no_manifest) and (os.path.getsize(path) > 20000000):
        hash0, manifest0 = _compute_local_file_sha1_and_manifest(path)
        if manifest0 is None:
            raise Exception(f'Unable to compute hash of file: {path}')
        manifest_uri = _store_json(manifest0)
        protocol, algorithm, manifest_hash, additional_path, query = _parse_kachery_uri(manifest_uri)
    else:
        hash0 = _get_file_hash(path)
        manifest_hash = None
    assert hash0 is not None
    sha1_directory = f'{_kachery_storage_dir()}/sha1'
    path0 = _get_path_ext(hash=hash0, create=True, directory=sha1_directory)
    if not os.path.exists(path0):
        tmp_path = path0 + '.copying.' + _random_string(6)
        shutil.copyfile(path, tmp_path)
        _rename_file(tmp_path, path0, remove_if_exists=False)
    return path0, hash0, manifest_hash

def _local_kachery_storage_link_file(*, path: str, _no_manifest=False) -> Tuple[str, str, Union[str, None]]:
    from ._store_file import _store_json # don't want circular dependencies
    if (not _no_manifest) and (os.path.getsize(path) > 20000000):
        hash0, manifest0 = _compute_local_file_sha1_and_manifest(path)
        if manifest0 is None:
            raise Exception(f'Unable to compute hash of file: {path}')
        manifest_uri = _store_json(manifest0)
        protocol, algorithm, manifest_hash, additional_path, query = _parse_kachery_uri(manifest_uri)
    else:
        hash0 = _get_file_hash(path)
        manifest_hash = None
    assert hash0 is not None
    sha1_directory = f'{_kachery_storage_dir()}/sha1'
    path0 = _get_path_ext(hash=hash0, create=True, directory=sha1_directory)
    if not os.path.exists(path0):
        tmp_path = path0 + '.link.' + _random_string(6)
        with open(tmp_path, 'w') as f:
            json.dump({
                'path': os.path.abspath(path),
                'manifest_hash': manifest_hash,
                'stat': {
                    'size': os.stat(path).st_size,
                    'mtime': os.stat(path).st_mtime
                }
            }, f)
        _rename_file(tmp_path, path0 + '.link', remove_if_exists=True)
    return path0, hash0, manifest_hash

def _get_file_hash(path: str, *, _cache_only=False):
    algorithm = 'sha1'
    if os.path.getsize(path) < 100000:
        # if it is a small file, we can compute the hash directly
        # this is important when the kachery storage dir is on a remote file system
        return _compute_file_hash(path, algorithm=algorithm)
    path = os.path.abspath(path)
    basename = os.path.basename(path)
    sha1_directory = f'{_kachery_storage_dir()}/sha1'
    if len(basename) == _length_of_hash_for_algorithm(algorithm):
        # suspect it is itself a file in the cache
        if _get_path_ext(hash=basename, create=False, directory=sha1_directory) == path:
            # in that case we don't need to compute
            return basename

    if _cache_only:
        return None
    hash1 = _compute_file_hash(path, algorithm=algorithm)
    
    if not hash1:
        return None

    return hash1

def _compute_file_hash(path: str, algorithm: str) -> Optional[str]:
    if not os.path.exists(path):
        return None
    if (os.path.getsize(path) > 1024 * 1024 * 100):
        print('Computing {} of {}'.format(algorithm, path))
    BLOCKSIZE = 65536
    hashsum = getattr(hashlib, algorithm)()
    with open(path, 'rb') as file:
        buf = file.read(BLOCKSIZE)
        while len(buf) > 0:
            hashsum.update(buf)
            buf = file.read(BLOCKSIZE)
    return hashsum.hexdigest()

def _length_of_hash_for_algorithm(algorithm):
    if algorithm == 'sha1':
        return 40
    elif algorithm == 'md5':
        return 32
    else:
        raise Exception('Unexpected algorithm: {}'.format(algorithm))

def _get_path_ext(hash: str, *, create: bool=True, directory: str) -> str:
    path1 = os.path.join(hash[0:2], hash[2:4], hash[4:6])
    path0 = os.path.join(str(directory), path1)
    if create:
        if not os.path.exists(path0):
            try:
                os.makedirs(path0)
            except:
                if not os.path.exists(path0):
                    raise Exception('Unable to make directory: ' + path0)
    return os.path.join(path0, hash)

def _load_bytes_from_local_file(local_fname: str, *, start: Union[int, None]=None, end: Union[int, None]=None, write_to_stdout: bool=False) -> Union[bytes, None]:
    size0 = os.path.getsize(local_fname)
    if start is None:
        start = 0
    if end is None:
        end = size0
    if start < 0 or start > size0 or end < start or end > size0:
        raise Exception('Invalid start/end range for file of size {}: {} - {}'.format(size0, start, end))
    if start == end:
        return bytes()
    with open(local_fname, 'rb') as f:
        f.seek(start)
        if write_to_stdout:
            ii = start
            while ii < end:
                nn = min(end - ii, 4096)
                data0 = f.read(nn)
                ii = ii + nn
                sys.stdout.buffer.write(data0)
            return None
        else:
            return f.read(end-start)

def _rename_file(path1: str, path2: str, remove_if_exists: bool) -> None:
    if os.path.abspath(path1) == os.path.abspath(path2):
        return
    if os.path.exists(path2):
        if remove_if_exists:
            try:
                os.unlink(path2)
            except:
                # maybe it was removed by someone else
                pass
        else:
            # already exists, let's just let it be
            return
    try:
        os.rename(path1, path2)
    except:
        if os.path.exists(path2):
            if not remove_if_exists:
                # all good
                return
            raise Exception('Problem renaming file: {} -> {}'.format(path1, path2))
        else:
            raise Exception('Problem renaming file:: {} -> {}'.format(path1, path2))

def _compute_local_file_sha1_and_manifest(path):
    algorithm = 'sha1'
    manifest = {
        'size': 0,
        'sha1': '',
        'chunks': []
    }
    if not os.path.exists(path):
        return None, None
    size0 = os.path.getsize(path)
    if (size0 > 1024 * 1024 * 100):
        print('Computing {} and manifest of {}'.format(algorithm, path))

    chunk_size = 20000000

    hashsum = getattr(hashlib, algorithm)()
    with open(path, 'rb') as file:
        pos = 0
        while pos < size0:
            
            this_chunk_size = min(chunk_size, size0 - pos)

            this_chunk_hashsum = getattr(hashlib, algorithm)()
            buf = file.read(this_chunk_size)
            this_chunk_hashsum.update(buf)
            
            hashsum.update(buf)
            
            chunk = {
                'start': pos,
                'end': pos + this_chunk_size,
                'sha1': this_chunk_hashsum.hexdigest()
            }
            manifest['chunks'].append(chunk)
            
            pos = pos + this_chunk_size
            
    sha1 = hashsum.hexdigest()
    manifest['sha1'] = sha1
    manifest['size'] = size0
    return sha1, manifest

def _random_string(num_chars: int) -> str:
    chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    return ''.join(random.choice(chars) for _ in range(num_chars))