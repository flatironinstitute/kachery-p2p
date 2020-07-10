from typing import Tuple, Union
from types import SimpleNamespace
import numpy as np
import subprocess
import time
import os
import pathlib
import json
import time
from typing import Optional
import kachery as ka
from ._temporarydirectory import TemporaryDirectory
from ._shellscript import ShellScript

def _api_port():
    return os.getenv('KACHERY_P2P_API_PORT', 20431)

def get_channels():
    port = _api_port()
    url = f'http://localhost:{port}/getState'
    resp = _http_post_json(url, dict())
    if not resp['success']:
        raise Exception(resp['error'])
    return resp['state']['channels']

def join_channel(channel_name):
    port = _api_port()
    url = f'http://localhost:{port}/joinChannel'
    resp = _http_post_json(url, dict(channelName=channel_name))
    if not resp['success']:
        raise Exception(resp['error'])

def leave_channel(channel_name):
    port = _api_port()
    url = f'http://localhost:{port}/leaveChannel'
    resp = _http_post_json(url, dict(channelName=channel_name))
    if not resp['success']:
        raise Exception(resp['error'])

def find_file(uri):
    port = _api_port()
    url = f'http://localhost:{port}/findFile'
    protocol, algorithm, hash0, additional_path = _parse_kachery_uri(uri)
    assert algorithm == 'sha1'
    file_key = dict(
        sha1=hash0
    )
    return _http_post_json_receive_json_socket(url, dict(fileKey=file_key))

def _parse_kachery_uri(uri: str) -> Tuple[str, str, str, str]:
    listA = uri.split('?')
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
    return protocol, algorithm, hash0, additional_path

def load_file(uri: str, dest: Union[str, None]=None):
    local_path = ka.load_file(uri, dest=dest)
    if local_path is not None:
        return local_path
    for r in find_file(uri):
        timer = time.time()
        a = _load_file_helper(primary_node_id=r['primaryNodeId'], swarm_name=r['swarmName'], file_key=r['fileKey'], file_info=r['fileInfo'], dest=dest)
        if a is not None:
            elapsed = time.time() - timer
            size = r["fileInfo"]["size"]
            rate = size / elapsed / (1024 * 1024)
            print(f'Downloaded {size} bytes in {elapsed} sec ({rate} MB/sec)')
            return a
    return None

def load_object(uri: str):
    local_path = load_file(uri)
    if local_path is None:
        return None
    return ka.load_object(uri)

def load_text(uri: str):
    local_path = load_file(uri)
    if local_path is None:
        return None
    return ka.load_text(uri)

def load_npy(uri: str):
    local_path = load_file(uri)
    if local_path is None:
        return None
    return ka.load_npy(uri)

def store_file(path: str, basename: Union[str, None]=None):
    return ka.store_file(path, basename=basename)

def store_object(object: dict, basename: Union[str, None]=None):
    return ka.store_object(object)

def store_text(text: str, basename: Union[str, None]=None):
    return ka.store_text(text, basename=basename)

def store_npy(array: np.ndarray, basename: Union[str, None]=None):
    return ka.store_npy(array, basename=basename)

def get_node_id():
    x = _probe_daemon()
    assert x is not None, 'Unable to connect to daemon.'
    return x['nodeId']

def _probe_daemon():
    port = _api_port()
    url = f'http://localhost:{port}/probe'
    try:
        x = _http_get_json(url)
    except:
        return None
    return x

def start_daemon(method='npx', channels=[], verbose=0):
    from kachery_p2p import __version__

    if _probe_daemon() is not None:
        raise Exception('Cannot start daemon. Already running.')

    api_port = _api_port()
    config_dir = os.getenv('KACHERY_P2P_CONFIG_DIR', f'{pathlib.Path.home()}/.kachery-p2p')

    start_args = []
    for ch in channels:
        start_args.append(f'--channel {ch}')
    start_args.append(f'--verbose {verbose}')

    if method == 'npx':
        try:
            subprocess.check_call(['npx', 'check-node-version', '--print', '--node', '>=12'])
        except:
            raise Exception('Please install nodejs version >=12. This is required in order to run kachery-p2p-daemon.')
        
        ss = ShellScript(f'''
        #!/bin/bash
        set -ex

        export KACHERY_P2P_API_PORT="{api_port}"
        export KACHERY_P2P_CONFIG_DIR="{config_dir}"
        exec npx kachery-p2p-daemon@0.2.6 start {' '.join(start_args)}
        ''')
        ss.start()
        try:
            ss.wait()
        finally:
            ss.stop()
            ss.kill()
    elif method == 'dev':
        thisdir = os.path.dirname(os.path.realpath(__file__))
        ss = ShellScript(f'''
        #!/bin/bash
        set -ex

        export KACHERY_P2P_API_PORT="{api_port}"
        export KACHERY_P2P_CONFIG_DIR="{config_dir}"
        exec node --experimental-modules {thisdir}/../daemon/src/cli.js start {' '.join(start_args)}
        ''')
        ss.start()
        try:
            ss.wait()
        finally:
            ss.stop()
            ss.kill()
    else:
        raise Exception(f'Invalid method for starting daemon: {method}')

def stop_daemon():
    port = _api_port()
    url = f'http://localhost:{port}/halt'
    try:
        x = _http_get_json(url)
    except:
        return False
    return x.get('success')

def _load_file_helper(primary_node_id, swarm_name, file_key, file_info, dest):
    port = _api_port()
    url = f'http://localhost:{port}/downloadFile'
    uri = _get_kachery_uri_from_file_key(file_key)
    with TemporaryDirectory() as tmpdir:
        fname = tmpdir + '/download.dat'
        _http_post_download_file(url, dict(primaryNodeId=primary_node_id, swarmName=swarm_name, fileKey=file_key, fileSize=file_info['size']), total_size=file_info['size'], dest_path=fname)
        with ka.config(use_hard_links=True):
            expected_hash = file_key['sha1']
            hash0 = ka.get_file_hash(fname)
            if hash0 != expected_hash:
                print(f'Unexpected: hashes do not match: {expected_hash} <> {hash0}')
                return None
            ka.store_file(fname)
            return ka.load_file(uri, dest=dest)

def _get_kachery_uri_from_file_key(file_key):
    return f'sha1://{file_key["sha1"]}'

def _http_post_download_file(url: str, data: dict, total_size: int, dest_path: str):
    try:
        import requests
    except:
        raise Exception('Error importing requests *')

    with requests.post(url, json=data, stream=True) as r:
        r.raise_for_status()
        bytes_downloaded = 0
        timer = time.time()
        with open(dest_path, 'wb') as f:
            for chunk in r.iter_content(chunk_size=8192): 
                bytes_downloaded = bytes_downloaded + len(chunk)
                elapsed = time.time() - timer
                if elapsed >=3:
                    timer = time.time()
                    print(f'Downloaded {bytes_downloaded} of {total_size} bytes')
                f.write(chunk)

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