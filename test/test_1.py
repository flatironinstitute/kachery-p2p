import time
import os
from kachery_p2p._shellscript import ShellScript
from kachery_p2p._temporarydirectory import TemporaryDirectory
from kachery_p2p._preventkeyboardinterrupt import PreventKeyboardInterrupt
import pytest

class KPEnv:
    def __init__(self, test_daemon):
        self._test_daemon = test_daemon
    def __enter__(self):
        self._old_kachery_storage_dir = os.getenv('KACHERY_STORAGE_DIR', None)
        self._old_kachery_p2p_api_port = os.getenv('KACHERY_P2P_API_PORT', None)
        self._old_kachery_p2p_config_dir = os.getenv('KACHERY_P2P_CONFIG_DIR', None)
        os.environ['KACHERY_STORAGE_DIR'] = self._test_daemon._storage_dir
        os.environ['KACHERY_P2P_API_PORT'] = str(self._test_daemon._api_port)
        os.environ['KACHERY_P2P_CONFIG_DIR'] = self._test_daemon._storage_dir
        return self
    def __exit__(self, type, value, traceback):
        if self._old_kachery_storage_dir:
            os.putenv('KACHERY_STORAGE_DIR', self._old_kachery_storage_dir)
        if self._old_kachery_p2p_api_port:
            os.putenv('KACHERY_P2P_API_PORT', self._old_kachery_p2p_api_port)
        if self._old_kachery_p2p_config_dir:
            os.putenv('KACHERY_P2P_CONFIG_DIR', self._old_kachery_p2p_config_dir)

class Daemon:
    def __init__(self, *, channels, api_port, storage_dir, port=None, bootstraps=None):
        self._channels = channels
        self._storage_dir = storage_dir
        self._api_port = api_port
        self._script = None
        self._port = port
        self._bootstraps = bootstraps
    def start(self):
        opts = []
        for ch in self._channels:
            opts.append(f'--channel {ch}')
        if self._bootstraps is not None:
            for bs in self._bootstraps:
                opts.append(f'--bootstrap {bs}')
        if self._port is not None:
            opts.append(f'--port {self._port}')
        print('Starting daemon')
        self._script = ShellScript(f'''
        #!/bin/bash
        set -ex

        export KACHERY_STORAGE_DIR={self._storage_dir}
        export KACHERY_P2P_API_PORT={self._api_port}
        export KACHERY_P2P_CONFIG_DIR=$KACHERY_STORAGE_DIR
        # export KACHERY_P2P_DISABLE_OUTGOING_WEBSOCKET_CONNECTIONS=true
        mkdir -p $KACHERY_STORAGE_DIR
        exec kachery-p2p-start-daemon --method dev {' '.join(opts)}
        ''')
        self._script.start()
        with KPEnv(self):
            import kachery_p2p as kp
            while True:
                time.sleep(1)
                try:
                    channels = kp.get_channels()
                except:
                    channels = None
                if channels is not None:
                    okay = True
                    for ch in self._channels:
                        if ch not in [ch['name'] for ch in channels]:
                            okay = False
                    if okay:
                        break
        print('Daemon started')
    def stop(self):
        ss = ShellScript(f'''
        #!/bin/bash
        set -ex

        export KACHERY_STORAGE_DIR={self._storage_dir}
        export KACHERY_P2P_API_PORT={self._api_port}
        export KACHERY_P2P_CONFIG_DIR=$KACHERY_STORAGE_DIR
        exec kachery-p2p-stop-daemon
        ''')
        ss.start()
        ss.wait()
    

def run_test(test_nodes, tmpdir):
    api_port = 30001
    try:
        # Start the daemons
        for tn in test_nodes:
            d = Daemon(
                channels=tn['channels'],
                api_port=api_port,
                storage_dir=tmpdir + f'/test_storage_{api_port}_{_randstr(5)}',
                port=tn['port'],
                bootstraps=tn['bootstraps']
            )
            tn['daemon'] = d
            tn['api_port'] = api_port
            print(f'starting daemon: {tn["name"]}')
            d.start()
            api_port = api_port + 1
            
        # pause
        time.sleep(3)

        # Store some objects
        for tn in test_nodes:
            d = tn['daemon']
            tn['uris'] = []
            with KPEnv(d):
                import kachery as ka
                for obj in tn['objects_to_store']:
                    uri = ka.store_object(obj)
                    tn['uris'].append(uri)

        
        # Pause
        time.sleep(3)

        # Load the objects
        for tn in test_nodes:
            d = tn['daemon']
            with KPEnv(d):
                import kachery_p2p as kp
                import kachery as ka
                for tn2 in test_nodes:
                    for uri in tn2['uris']:
                        print(f'Node {tn["name"]} is loading {uri} from node {tn2["name"]}')
                        obj = kp.load_object(uri)
                        assert(obj is not None)
    finally:
        with PreventKeyboardInterrupt():
            for tn in test_nodes:
                d = tn['daemon']
                print(f'stopping daemon: {tn["name"]}')
                try:
                    d.stop()
                except:
                    print('WARNING: Failed to stop daemon.')

def test_1(tmpdir):    
    import kachery as ka
    N = 3
    objects = [
        dict(a=a, x=[j for j in range(1000000)])
        for a in range(0, N)
    ]
    test_nodes = []
    for a in range(0, N):
        tn = dict(
            name=[f'Node {a}'],
            channels = ['testA'],
            objects_to_store = [objects[a]],
            port = 42000 + a,
            bootstraps=["localhost:42000"]
        )
        test_nodes.append(tn)
    run_test(test_nodes=test_nodes, tmpdir=str(tmpdir))

def test_2(tmpdir):    
    import kachery as ka
    import kachery_p2p as kp
    N = 3
    objects = [
        dict(a=a, x=[j for j in range(1000000)])
        for a in range(0, N)
    ]
    test_nodes = []
    for a in range(0, N):
        tn = dict(
            name=[f'Node {a}'],
            channels = [f'testA-{a}'],
            objects_to_store = [objects[a]],
            port = 42000 + a,
            bootstraps=["localhost:42000"]
        )
        test_nodes.append(tn)
    with pytest.raises(kp.LoadFileError):
        run_test(test_nodes=test_nodes, tmpdir=str(tmpdir))

def _randstr(n):
    import random
    import string
    return ''.join(random.choice(string.ascii_lowercase) for _ in range(n))