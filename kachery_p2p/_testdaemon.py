import time
import os
from kachery_p2p._shellscript import ShellScript

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

class TestDaemon:
    def __init__(self, *, channels, api_port, storage_dir, port=None, bootstraps=None):
        self._channels = channels
        self._storage_dir = storage_dir
        self._api_port = api_port
        self._script = None
        self._port = port
        self._bootstraps = bootstraps
    def testEnv(self):
        return KPEnv(test_daemon=self)
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
