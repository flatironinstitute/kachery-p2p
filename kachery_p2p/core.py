from types import SimpleNamespace
import time
import os
import json
import time
from typing import Optional
import kachery as ka

def _api_port():
    return 20431

# def load_file(kachery_path, _debug=False):
#     if not _debug:
#         x = ka.load_file(kachery_path)
#         if x is not None:
#             return x
#     port = _api_port()
#     url = f'http://localhost:{port}/requestFile'
#     resp = _http_post_json(url, dict(kacheryPath=kachery_path, opts={}))
#     if not resp['success']:
#         raise Exception('Error requesting file.')
#     R = resp['outgoingFileRequest']
#     request_id = R['requestId']
#     while True:
#         url = f'http://localhost:{port}/getFileRequest'
#         resp = _http_post_json(url, dict(requestId=request_id))
#         if not resp['success']:
#             print(resp)
#             raise Exception('Error getting file request.')
#         outgoing_file_request = resp['outgoingFileRequest']
#         status = outgoing_file_request['status']
#         print(status)
#         time.sleep(1)

def get_swarms():
    port = _api_port()
    url = f'http://localhost:{port}/getState'
    resp = _http_post_json(url, dict())
    if not resp['success']:
        raise Exception(resp['error'])
    return resp['state']['swarms']

def join_swarm(swarm_name):
    port = _api_port()
    url = f'http://localhost:{port}/joinSwarm'
    resp = _http_post_json(url, dict(swarmName=swarm_name))
    if not resp['success']:
        raise Exception(resp['error'])

def leave_swarm(swarm_name):
    port = _api_port()
    url = f'http://localhost:{port}/leaveSwarm'
    resp = _http_post_json(url, dict(swarmName=swarm_name))
    if not resp['success']:
        raise Exception(resp['error'])

def find_file(path):
    port = _api_port()
    url = f'http://localhost:{port}/findFile'
    resp = _http_post_json(url, dict(kacheryPath=path))
    if not resp['success']:
        raise Exception(resp['error'])
    return resp['results']

def load_file(path):
    results = find_file(path)
    if len(results) == 0:
        return None
    result0 = results[0]

    port = _api_port()
    url = f'http://localhost:{port}/downloadFile'
    resp = _http_post_json(url, dict(swarmName=result0['swarmName'], nodeIdPath=result0['nodeIdPath'], kacheryPath=path))
    if not resp['success']:
        raise Exception(resp['error'])
    return resp

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