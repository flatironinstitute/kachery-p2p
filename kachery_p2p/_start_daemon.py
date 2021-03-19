import os
import pathlib
import subprocess
from ._daemon_connection import _api_url, _probe_daemon, _api_host, _api_port
from typing import List
from ._misc import _http_get_json
from ._shellscript import ShellScript
from .protocol_version import __version__

def start_daemon(*,
    port: int=0,
    udp_port: int=0,
    websocket_port: int=0,
    label: str,
    method: str='npx',
    verbose: int=0,
    host: str='',
    public_url: str='',
    noudp: bool=False,
    isbootstrap: bool=False,
    nomulticast: bool=False,
    static_config: str='',
    node_arg: List[str]=[]
):
    """Used internally. Use the kachery-p2p-start-daemon command in the terminal.
    """

    if _probe_daemon() is not None:
        raise Exception('Cannot start daemon. Already running.')

    api_port = _api_port()
    api_host = _api_host()
    config_dir = os.getenv('KACHERY_P2P_CONFIG_DIR', f'{pathlib.Path.home()}/.kachery-p2p')

    start_args = []
    if isbootstrap:
        start_args.append(f'--isbootstrap')
    if noudp:
        start_args.append(f'--noudp')
    if nomulticast:
        start_args.append(f'--nomulticast')
    start_args.append(f'--verbose {verbose}')
    if host:
        start_args.append(f'--host {host}')
    if public_url:
        start_args.append(f'--public-url {public_url}')
    if websocket_port > 0:
        start_args.append(f'--websocket-port {websocket_port}')
    if udp_port is not None:
        start_args.append(f'--udp-port {udp_port}')
    if static_config:
        start_args.append(f'--static-config {static_config}')
    start_args.append(f'--label {label}')
    start_args.append(f'--http-port {port}')

    assert method in ['npx', 'dev'], f'Invalid method for start_daemon: {method}'

    thisdir = os.path.dirname(os.path.realpath(__file__))
    if method == 'npx':
        try:
            subprocess.check_call(['npx', 'check-node-version', '--print', '--node', '>=12'])
        except:
            raise Exception('Please install nodejs version >=12. This is required in order to run kachery-p2p-daemon.')
        
        
        for na in node_arg:
            start_args.append(f'--node-arg={na}')

        npm_package = f'{thisdir}/kachery-p2p-daemon-{__version__}.tgz'
        if not os.path.exists(npm_package):
            raise Exception(f'No such file: {npm_package}')
    
        ss = ShellScript(f'''
        #!/bin/bash
        set -ex

        export KACHERY_P2P_API_PORT="{api_port}"
        export KACHERY_P2P_API_HOST="{api_host}"
        export KACHERY_P2P_CONFIG_DIR="{config_dir}"
        npm install -g -y {npm_package}
        exec kachery-p2p-daemon start {' '.join(start_args)}
        ''')
        ss.start()
        try:
            retcode = ss.wait()
        finally:
            ss.stop()
            ss.kill()
    elif method == 'dev':
        ss = ShellScript(f'''
        #!/bin/bash
        set -ex

        export KACHERY_P2P_API_PORT="{api_port}"
        export KACHERY_P2P_API_HOST="{api_host}"
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

def stop_daemon(api_port=None, api_host=None):
    """Stop the kachery daemon (take the node offline)

    Args:
        api_port ([type], optional): Optional override of the api port for the daemon. Defaults to None.
    """
    api_url = _api_url(api_port=api_port, api_host=api_host)
    url = f'{api_url}/halt'
    try:
        x = _http_get_json(url)
    except:
        return False
    return x.get('success')