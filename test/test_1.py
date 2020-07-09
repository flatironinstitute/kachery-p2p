import time
import os
from kachery_p2p._shellscript import ShellScript
from kachery_p2p._temporarydirectory import TemporaryDirectory
from kachery_p2p._preventkeyboardinterrupt import PreventKeyboardInterrupt

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
    def __init__(self, *, api_port, storage_dir):
        self._script = None
        self._storage_dir = storage_dir
        self._api_port = api_port
    def start(self):
        thisdir = os.path.dirname(os.path.realpath(__file__))
        self._script = ShellScript(f'''
        #!/bin/bash
        set -ex

        export KACHERY_STORAGE_DIR={self._storage_dir}
        export KACHERY_P2P_API_PORT={self._api_port}
        export KACHERY_P2P_CONFIG_DIR=$KACHERY_STORAGE_DIR
        exec node {thisdir}/../daemon/src/cli.js start
        ''')
        self._script.start()
        
        with KPEnv(self):
            import kachery_p2p as kp
            while True:
                try:
                    channels = kp.get_channels()
                    if channels is not None:
                        break
                except:
                    time.sleep(1)
                    pass
    def stop(self):
        with KPEnv(self):
            import kachery_p2p as kp
            try:
                kp.stop_daemon()
            except:
                pass
            self._script.stop()
    

def test_1():
    with TemporaryDirectory() as tmpdir:
        test_nodes = []
        try:
            for a in range(1, 6):
                d = Daemon(api_port=30000 + a, storage_dir=tmpdir + f'/test_storage_{a}')
                print('starting daemon.')
                d.start()
                test_nodes.append(dict(
                    daemon=d,
                    a=a
                ))
            for n in test_nodes:
                d = n['daemon']
                with KPEnv(d):
                    import kachery_p2p as kp
                    kp.join_channel('test_channel')
            for n in test_nodes:
                d = n['daemon']
                a = n['a']
                with KPEnv(d):
                    import kachery as ka
                    uri = ka.store_object(dict(a=a, x=[j for j in range(1000000)]))
                    n['uri'] = uri
            with KPEnv(test_nodes[0]['daemon']):
                import kachery_p2p as kp
                for i in range(1, len(test_nodes)):
                    n = test_nodes[i]
                    uri = n['uri']
                    x = kp.load_file(uri)
                    assert x is not None
        finally:
            with PreventKeyboardInterrupt():
                for n in test_nodes:
                    d = n['daemon']
                    print('stopping daemon.')
                    try:
                        d.stop()
                    except:
                        print('WARNING: Failed to stop daemon.')
    