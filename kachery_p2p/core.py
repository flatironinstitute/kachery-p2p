import hashlib
import json
import os
import pathlib
import subprocess
import sys
import time
from types import SimpleNamespace
from typing import Dict, List, Optional, Tuple, Union
from urllib.parse import parse_qs

import kachery as ka
import numpy as np

from ._shellscript import ShellScript
from ._temporarydirectory import TemporaryDirectory
from .exceptions import LoadFileError

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

def _api_port():
    return os.getenv('KACHERY_P2P_API_PORT', 20431)

def get_channels() -> List[str]:
    port = _api_port()
    url = f'http://localhost:{port}/probe'
    resp = _http_post_json(url, dict())
    # if not resp['success']:
    #     raise Exception(resp['error'])
    return resp['channels']

def find_file(uri):
    if uri.startswith('sha1dir://'):
        uri = _resolve_file_uri_from_dir_uri(uri)
        if uri is None:
            raise Exception('Unable to find file.')
    if _global_config['nop2p']:
        class empty_iterator:
            def __init__(self):
                pass

            def __iter__(self):
                return self

            def __next__(self):
                raise StopIteration
        return empty_iterator()
    port = _api_port()
    url = f'http://localhost:{port}/findFile'
    protocol, algorithm, hash0, additional_path, query = _parse_kachery_uri(uri)
    assert algorithm == 'sha1'
    file_key = _create_file_key(sha1=hash0, query=query)
    return _http_post_json_receive_json_socket(url, dict(fileKey=file_key))

def _parse_kachery_uri(uri: str) -> Tuple[str, str, str, str, dict]:
    listA = uri.split('?')
    if len(listA) > 1:
        query = parse_qs(listA[1])
    else:
        query = {}
    list0 = listA[0].split('/')
    protocol = list0[0].replace(':', '')
    hash0 = list0[2]
    if '.' in hash0:
        hash0 = hash0.split('.')[0]
    additional_path = '/'.join(list0[3:])
    algorithm = None
    for alg in ['sha1', 'md5', 'key']:
        if protocol.startswith(alg):
            algorithm = alg
    if algorithm is None:
        raise Exception('Unexpected protocol: {}'.format(protocol))
    return protocol, algorithm, hash0, additional_path, query

def load_file(uri: str, dest: Union[str, None]=None, p2p: bool=True, from_node: Union[str, None]=None, from_channel: Union[str, None]=None):
    if uri.startswith('sha1dir://'):
        uri0 = _resolve_file_uri_from_dir_uri(uri)
        if uri0 is None:
            return None
        uri = uri0
    local_path = ka.load_file(uri, dest=dest)
    if local_path is not None:
        return local_path
    try_p2p = p2p and (not _global_config['nop2p'])
    if try_p2p:
        try:
            port = _api_port()
            url = f'http://localhost:{port}/loadFile' # todo: finish
            protocol, algorithm, hash0, additional_path, query = _parse_kachery_uri(uri)
            assert algorithm == 'sha1'
            file_key = _create_file_key(sha1=hash0, query=query)
            sock = _http_post_json_receive_json_socket(url, dict(
                fileKey=file_key,
                fromNode=from_node,
                fromChannel=from_channel
            ))
            for r in sock:
                try:
                    type0 = r.get('type')
                except:
                    raise Exception(f'Unexpected response from daemon: {r}: {uri}')
                if type0 == 'finished':
                    print(f'Loaded file: {uri}')
                    ret = ka.load_file(f'sha1://{hash0}', dest=dest)
                    assert ret is not None, 'Unexpected problem loading file. Please check that you are using the same KACHERY_STORAGE_DIR environment variable between the kachery-p2p daemon and this program.'
                    return ret
                elif type0 == 'progress':
                    bytes_loaded = r['bytesLoaded']
                    bytes_total = r['bytesTotal']
                    node_id = r['nodeId']
                    pct = (bytes_loaded / bytes_total) * 100
                    if node_id:
                        nodestr = f' from {node_id[:6]}'
                    else:
                        nodestr = ''
                    print(f'Loaded {bytes_loaded} of {bytes_total} bytes{nodestr} ({pct:.1f} %): {uri}')
                elif type0 == 'error':
                    raise LoadFileError(f'Error loading file: {r["error"]}: {uri}')
                else:
                    raise Exception(f'Unexpected message from daemon: {r}')
            raise Exception(f'Unable to download file. Connection to daemon closed before finished: {uri}')
        except:
            if len(_global_config['file_server_urls']) == 0:
                raise
    for url in _global_config['file_server_urls']:
        try:
            path = _load_file_from_file_server(uri=uri, dest=dest, file_server_url=url)
        except Exception as e:
            print(str(e))
            path = None
        if path:
            return path
    raise Exception(f'Unable to download file: {uri}')

def _load_file_from_file_server(*, uri, dest, file_server_url):
    protocol, algorithm, hash0, additional_path, query = _parse_kachery_uri(uri)
    if query.get('manifest'):
        manifest = load_object(f'sha1://{query["manifest"][0]}')
        if manifest is None:
            print('Unable to load manifest')
            return None
        assert manifest['sha1'] == hash0, 'Manifest sha1 does not match expected.'
        chunk_local_paths = []
        for ii, ch in enumerate(manifest['chunks']):
            if len(manifest['chunks']) > 1:
                print(f'load_bytes: Loading chunk {ii + 1} of {len(manifest["chunks"])}')
            a = load_file(
                uri=f'sha1://{ch["sha1"]}?chunkOf={hash0}~{ch["start"]}~{ch["end"]}'
            )
            if a is None:
                print('Unable to load data from chunk')
                return None
            chunk_local_paths.append(a)
        with TemporaryDirectory() as tmpdir:
            concat_fname = f'{tmpdir}/concat_{hash0}'
            print('Concatenating chunks...')
            sha1_concat = _concatenate_files_and_compute_sha1(paths=chunk_local_paths, dest=concat_fname)
            assert sha1_concat == hash0, f'Unexpected sha1 of concatenated file: {sha1_concat} <> {hash0}'
            ka.core._store_local_file_in_cache(path=concat_fname, hash=sha1_concat, algorithm='sha1', config=ka.core._load_config())
            ff = ka.load_file('sha1://' + hash0)
            assert ff is not None, f'Unexpected problem. Unable to load file after storing in local cache: sha1://{hash0}'
            return ff
    if query.get('chunkOf'):
        chunkOf_str = query.get('chunkOf')[0]
    else:
        chunkOf_str = None
    
    with TemporaryDirectory() as tmpdir:
        tmp_fname = tmpdir + f'/download_{hash0}'
        url = f'{file_server_url}/sha1/{hash0}'
        if chunkOf_str is not None:
            url = url + f'?chunkOf={chunkOf_str}'
        sha1 = _download_file_and_compute_sha1(url=url, fname=tmp_fname)
        assert hash0 == sha1, f'Unexpected sha1 of downloaded file: {sha1} <> {hash0}'
        # todo: think about how to do this without calling internal (private) function
        ka.core._store_local_file_in_cache(path=tmp_fname, hash=sha1, algorithm='sha1', config=ka.core._load_config())
        ff = ka.load_file('sha1://' + sha1)
        assert ff is not None, f'Unexpected problem. Unable to load file after storing in local cache: sha1://{hash0}'
        return ff
    


def _concatenate_files_and_compute_sha1(*, paths: List[str], dest: str):
    with open(dest, 'wb') as f_concat:
        sha1sum = hashlib.sha1()
        chunksize = 8192
        for path in paths:
            with open(path, "rb") as f:
                while True:
                    data = f.read(chunksize)
                    if data:
                        sha1sum.update(data)
                        f_concat.write(data)
                    else:
                        break
    return sha1sum.hexdigest()

def _download_file_and_compute_sha1(*, url, fname, start=None, end=None):
    try:
        import requests
    except:
        raise Exception('Error importing requests (in _download_file_and_compute_sha1)')
    if start is not None:
        assert end is not None
        headers = {"Range": f"bytes={start}-{end - 1}"}
    else:
        headers = {}
    with requests.get(url, headers=headers, stream=True) as r:
        r.raise_for_status()
        with open(fname, 'wb') as f:
            sha1sum = hashlib.sha1()
            for chunk in r.iter_content(chunk_size=8192): 
                # If you have chunk encoded response uncomment if
                # and set chunk_size parameter to None.
                #if chunk:
                sha1sum.update(chunk)
                f.write(chunk)
    return sha1sum.hexdigest()

def load_bytes(uri: str, start: int, end: int, write_to_stdout=False, p2p: bool=True, from_node: Union[str, None]=None, from_channel: Union[str, None]=None) -> Union[bytes, None]:
    ret = ka.load_bytes(uri, start=start, end=end, write_to_stdout=write_to_stdout)
    if ret is not None:
        return ret
    if not p2p:
        return    
    protocol, algorithm, hash0, additional_path, query = _parse_kachery_uri(uri)
    if query.get('manifest'):
        manifest = load_object(f'sha1://{query["manifest"][0]}')
        if manifest is None:
            print('Unable to load manifest')
            return None
        assert manifest['sha1'] == hash0, 'Manifest sha1 does not match expected.'
        data_chunks = []
        chunks_to_load = []
        for ch in manifest['chunks']:
            if start < ch['end'] and end > ch['start']:
                chunks_to_load.append(ch)
        for ii, ch in enumerate(chunks_to_load):
            if len(chunks_to_load) > 1:
                print(f'load_bytes: Loading chunk {ii + 1} of {len(chunks_to_load)}')
            a = load_bytes(
                uri=f'sha1://{ch["sha1"]}?chunkOf={hash0}~{ch["start"]}~{ch["end"]}',
                start=max(0, start - ch['start']),
                end=min(ch['end']-ch['start'], end-ch['start']
            ))
            if a is None:
                print('Unable to load bytes from chunk')
                return None
            data_chunks.append(a)
        return b''.join(data_chunks)
    
    path = load_file(uri=uri, from_node=from_node, from_channel=from_channel)
    if path is None:
        print('Unable to load file.')
        return None
    return ka.load_bytes(uri, start=start, end=end, write_to_stdout=write_to_stdout)

def read_dir(uri: str, p2p: bool=True):
    protocol, algorithm, hash0, additional_path, query = _parse_kachery_uri(uri)
    assert protocol == algorithm + 'dir'
    dd = load_object(algorithm + '://' + hash0, p2p=p2p)
    if dd is None:
        return None
    return ka.read_dir(uri)
        
def load_object(uri: str, p2p: bool=True, from_node: Union[str, None]=None, from_channel: Union[str, None]=None):
    local_path = load_file(uri, p2p=p2p, from_node=from_node, from_channel=from_channel)
    if local_path is None:
        return None
    return ka.load_object(uri)

def load_text(uri: str, p2p: bool=True, from_node: Union[str, None]=None, from_channel: Union[str, None]=None):
    local_path = load_file(uri, p2p=p2p, from_node=from_node, from_channel=from_channel)
    if local_path is None:
        return None
    return ka.load_text(uri)

def load_npy(uri: str, p2p: bool=True, from_node: Union[str, None]=None, from_channel: Union[str, None]=None):
    local_path = load_file(uri, p2p=p2p, from_node=from_node, from_channel=from_channel)
    if local_path is None:
        return None
    return ka.load_npy(uri)

def store_file(path: str, basename: Union[str, None]=None):
    return ka.store_file(path, basename=basename)

def store_object(object: dict, basename: Union[str, None]=None):
    return ka.store_object(object, basename=basename)

def store_text(text: str, basename: Union[str, None]=None):
    return ka.store_text(text, basename=basename)

def store_npy(array: np.ndarray, basename: Union[str, None]=None):
    return ka.store_npy(array, basename=basename)

def get_node_id(api_port=None):
    x = _probe_daemon(api_port=api_port)
    assert x is not None, 'Unable to connect to daemon.'
    return x['nodeId']

def _probe_daemon(api_port=None):
    if api_port is not None:
        port = api_port
    else:
        port = _api_port()
    url = f'http://localhost:{port}/probe'
    try:
        x = _http_get_json(url)
    except:
        return None
    return x

def start_daemon(*,
    config_path_or_url: str='',
    port: int=0,
    websocket_port: int=0,
    label: Union[str, None]=None,
    method: str='npx',
    channels: List[str]=[],
    verbose: int=0,
    host: str='',
    bootstrap: List[str],
    nobootstrap: bool=False,
    isbootstrap: bool=False,
    ismessageproxy: bool=False,
    isdataproxy: bool=False,
    nomulticast: bool=False,
    node_arg: List[str]=[]
):
    from kachery_p2p import __version__

    if _probe_daemon() is not None:
        raise Exception('Cannot start daemon. Already running.')

    api_port = _api_port()
    config_dir = os.getenv('KACHERY_P2P_CONFIG_DIR', f'{pathlib.Path.home()}/.kachery-p2p')

    start_args = []
    if config_path_or_url != '':
        start_args.append(f'--config {config_path_or_url}')
    for ch in channels:
        start_args.append(f'--channel {ch}')
    for b in bootstrap:
        start_args.append(f'--bootstrap {b}')
    if nobootstrap:
        start_args.append(f'--nobootstrap')
    if isbootstrap:
        start_args.append(f'--isbootstrap')
    if ismessageproxy:
        start_args.append(f'--ismessageproxy')
    if isdataproxy:
        start_args.append(f'--isdataproxy')
    if nomulticast:
        start_args.append(f'--nomulticast')
    start_args.append(f'--verbose {verbose}')
    if host:
        start_args.append(f'--host {host}')
    if websocket_port > 0:
        start_args.append(f'--websocket-port {websocket_port}')
    if label is not None:
        start_args.append(f'--label {label}')
    start_args.append(f'--http-port {port}')

    # Note that npx-latest/npm-latest uses the latest version of the daemon on npm, which may be desireable for some bootstrap nodes, but not adviseable if you want to be sure that kachery-p2p is constistent with the node daemon
    if (method == 'npx') or (method == 'npx-latest') or (method == 'npm') or (method == 'npm-latest'):
        try:
            subprocess.check_call(['npx', 'check-node-version', '--print', '--node', '>=12'])
        except:
            raise Exception('Please install nodejs version >=12. This is required in order to run kachery-p2p-daemon.')
        
        for na in node_arg:
            start_args.append(f'--node-arg={na}')

        while True:
            restarting = False
            use_latest = (method == 'npx-latest') or (method == 'npm-latest')
            if use_latest:    
                npm_package = 'kachery-p2p-daemon'
            else:
                npm_package = 'kachery-p2p-daemon@0.5.9'

            if method == 'npx' or method == 'npx-latest':
                ss = ShellScript(f'''
                #!/bin/bash
                set -ex

                export KACHERY_P2P_API_PORT="{api_port}"
                export KACHERY_P2P_CONFIG_DIR="{config_dir}"
                exec npx {npm_package} start {' '.join(start_args)}
                ''')
            elif method == 'npm' or method == 'npm-latest':
                ss = ShellScript(f'''
                #!/bin/bash
                set -ex

                export KACHERY_P2P_API_PORT="{api_port}"
                export KACHERY_P2P_CONFIG_DIR="{config_dir}"
                npm install -g {npm_package}
                exec kachery-p2p-daemon start {' '.join(start_args)}
                ''')
            else:
                raise Exception(f'Unexpected method: {method}')
            ss.start()
            if use_latest:
                original_latest_version = None
                for passnum in [1, 2]:
                    try:
                        original_latest_version = _check_latest_npm_package_version('kachery-p2p-daemon')
                    except:
                        if passnum == 1:
                            print('Unable to find latest version of package. Retrying in 60 seconds')
                            time.sleep(60)
                assert original_latest_version is not None, 'Unable to get latest version of daemon'
                print(f'Latest version of daemon is: {original_latest_version}')
            else:
                original_latest_version = None
            try:
                while True:
                    retcode = ss.wait(timeout = 120)
                    if retcode is not None:
                        break
                    if use_latest:
                        try:
                            latest_version = _check_latest_npm_package_version('kachery-p2p-daemon')
                        except:
                            print('WARNING: unable to determine latest version of kachery-p2p-daemon')
                            latest_version = None
                        if (latest_version is not None) and (latest_version is not original_latest_version):
                            print(f'New version of kachery-p2p daemon available ({latest_version} <> {original_latest_version}). Restarting.')
                            ss.stop()
                            restarting = True
            finally:
                ss.stop()
                ss.kill()
            if not restarting:
                return
    elif method == 'dev':
        thisdir = os.path.dirname(os.path.realpath(__file__))
        ss = ShellScript(f'''
        #!/bin/bash
        set -ex

        export KACHERY_P2P_API_PORT="{api_port}"
        export KACHERY_P2P_CONFIG_DIR="{config_dir}"
        cd {thisdir}/../daemon
        # exec node_modules/ts-node/dist/bin.js {' '.join(node_arg)} ./src/cli.ts start {' '.join(start_args)}
        exec node {' '.join(node_arg)} -r ts-node/register ./src/cli.ts start {' '.join(start_args)}
        ''')
        ss.start()
        try:
            ss.wait()
        finally:
            ss.stop()
            ss.kill()
    else:
        raise Exception(f'Invalid method for starting daemon: {method}')

def _check_latest_npm_package_version(package_name):
    output = subprocess.check_output(['npm', 'view', package_name, 'versions'])
    output = output.replace(b"'", b'"')
    versions = json.loads(output.strip())
    latest_version = versions[-1]
    return latest_version

def stop_daemon(api_port=None):
    if api_port is not None:
        port = api_port
    else:
        port = _api_port()
    url = f'http://localhost:{port}/halt'
    try:
        x = _http_get_json(url)
    except:
        return False
    return x.get('success')

def _resolve_file_uri_from_dir_uri(dir_uri, p2p: bool=True):
    protocol, algorithm, hash0, additional_path, query = _parse_kachery_uri(dir_uri)
    assert protocol == algorithm + 'dir'
    dd = load_object(algorithm + '://' + hash0, p2p=p2p)
    if dd is None:
        return None
    if additional_path:
        list0 = additional_path.split('/')
    else:
        list0 = []
    ii = 0
    while ii < len(list0):
        assert dd is not None
        name0 = list0[ii]
        if name0 in dd['dirs']:
            dd = dd['dirs'][name0]
        elif name0 in dd['files']:
            if ii + 1 == len(list0):
                hash1 = None
                algorithm1 = None
                for alg in ['sha1', 'md5']:
                    if alg in dd['files'][name0]:
                        hash1 = dd['files'][name0][alg]
                        algorithm1 = alg
                if hash1 is None:
                    return None
                return algorithm1 + '://' + hash1
            else:
                return None
        else:
            return None
        ii = ii + 1
    return None

# def _get_kachery_uri_from_file_key(file_key):
#     return f'sha1://{file_key["sha1"]}'

# def _http_post_download_file(url: str, data: dict, total_size: int, dest_path: str):
#     try:
#         import requests
#     except:
#         raise Exception('Error importing requests *')

#     with requests.post(url, json=data, stream=True) as r:
#         r.raise_for_status()
#         bytes_downloaded = 0
#         timer = time.time()
#         with open(dest_path, 'wb') as f:
#             for chunk in r.iter_content(chunk_size=8192): 
#                 bytes_downloaded = bytes_downloaded + len(chunk)
#                 elapsed = time.time() - timer
#                 if elapsed >=3:
#                     timer = time.time()
#                     print(f'Downloaded {bytes_downloaded} / {total_size} bytes')
#                 f.write(chunk)
#             assert bytes_downloaded == total_size, f'Unexpected number of bytes downloaded. {bytes_downloaded} <> {total_size}'
#             print(f'Finished downloading {total_size} bytes')

# def _http_post_download_file_data(url: str, data: dict, content_size: int):
#     try:
#         import requests
#     except:
#         raise Exception('Error importing requests *')

#     chunks = []
#     with requests.post(url, json=data, stream=True) as r:
#         r.raise_for_status()
#         bytes_downloaded = 0
#         for chunk in r.iter_content(chunk_size=8192): 
#             bytes_downloaded = bytes_downloaded + len(chunk)
#             chunks.append(chunk)
#     return b''.join(chunks)

def _http_get_json(url: str, verbose: Optional[bool] = None) -> dict:
    timer = time.time()
    if verbose is None:
        verbose = (os.environ.get('HTTP_VERBOSE', '') == 'TRUE')
    if verbose:
        print('_http_get_json::: ' + url)
    try:
        import requests
    except:
        raise Exception('Error importing requests *')
    req = requests.get(url)
    if req.status_code != 200:
        return dict(
            success=False,
            error='Error getting json: {} {}'.format(
                req.status_code, req.content.decode('utf-8'))
        )
    if verbose:
        print('Elapsed time for _http_get_json: {}'.format(time.time() - timer))
    return json.loads(req.content)

def _http_post_json(url: str, data: dict, verbose: Optional[bool] = None) -> dict:
    timer = time.time()
    if verbose is None:
        verbose = (os.environ.get('HTTP_VERBOSE', '') == 'TRUE')
    if verbose:
        print('_http_post_json::: ' + url)
    try:
        import requests
    except:
        raise Exception('Error importing requests *')
    req = requests.post(url, json=data)
    if req.status_code != 200:
        return dict(
            success=False,
            error='Error posting json: {} {}'.format(
                req.status_code, req.content.decode('utf-8'))
        )
    if verbose:
        print('Elapsed time for _http_post_json: {}'.format(time.time() - timer))
    return json.loads(req.content)

def _http_post_json_receive_json_socket(url: str, data: dict, verbose: Optional[bool] = None):
    timer = time.time()
    if verbose is None:
        verbose = (os.environ.get('HTTP_VERBOSE', '') == 'TRUE')
    if verbose:
        print('_http_post_json::: ' + url)
    try:
        import requests
    except:
        raise Exception('Error importing requests *')
    req = requests.post(url, json=data, stream=True)
    if req.status_code != 200:
        return dict(
            success=False,
            error='Error posting json: {} {}'.format(
                req.status_code, req.content.decode('utf-8'))
        )
    class custom_iterator:
        def __init__(self):
            pass

        def __iter__(self):
            return self

        def __next__(self):
            buf = bytearray(b'')
            while True:
                c = req.raw.read(1)
                if len(c) == 0:
                    raise StopIteration
                if c == b'#':
                    size = int(buf)
                    x = req.raw.read(size)
                    obj = json.loads(x)
                    return obj
                else:
                    buf.append(c[0])
    return custom_iterator()

def _create_file_key(*, sha1, query):
    file_key: Dict[Union[str, dict]] = dict(
        sha1=sha1
    )
    if 'manifest' in query:
        file_key['manifestSha1'] = query['manifest'][0]
    if 'chunkOf' in query:
        v = query['chunkOf'][0].split('~')
        assert len(v) ==3, 'Unexpected chunkOf in URI query.'
        file_key['chunkOf'] = {
            'fileKey': {
                'sha1': v[0]
            },
            'startByte': int(v[1]),
            'endByte': int(v[2])
        }
    return file_key
