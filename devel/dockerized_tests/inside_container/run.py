#!/usr/bin/env python3

import os
import kachery_p2p as kp
import signal

class TestDaemon:
    def __init__(self, num: int, tmpdir: str) -> None:
        self._port = 10100 + num
        self._storage_dir = f'/{tmpdir}/kachery-storage-{num}'
        self._config_dir = f'/{tmpdir}/kachery-config-{num}'
        self._temp_dir = f'/{tmpdir}/kachery-temp-{num}'
        self._label = f'test-{num}'
        os.mkdir(self._storage_dir)
        os.mkdir(self._config_dir)
        os.mkdir(self._temp_dir)
    def start(self):
        s = kp.ShellScript(f'''
        #!/bin/bash

        export KACHERY_P2P_API_PORT={self._port}
        export KACHERY_STORAGE_DIR={self._storage_dir}
        export KACHERY_P2P_CONFIG_DIR={self._config_dir}
        export KACHERY_TEMP_DIR={self._temp_dir}

        exec kachery-p2p start-daemon --label {self._label} --noudp
        ''')
        s.start()
        self._daemon_script = s
        self._wait_for_daemon_to_start()
    def stop(self):
        if not self._daemon_script.stopWithSignal(signal.SIGINT, timeout=5):
            raise Exception('Unable to stop daemon')
    def _wait_for_daemon_to_start(self):
        s = kp.ShellScript(f'''
        #!/bin/bash

        export KACHERY_P2P_API_PORT={self._port}
        export KACHERY_STORAGE_DIR={self._storage_dir}
        export KACHERY_P2P_CONFIG_DIR={self._config_dir}
        export KACHERY_TEMP_DIR={self._temp_dir}

        exec ./scripts/wait_for_daemon_to_start.py
        ''')
        s.start()
        s.wait()

def test_client_1(daemon):
    s = kp.ShellScript(f'''
    #!/bin/bash

    export KACHERY_P2P_API_PORT={daemon._port}
    export KACHERY_STORAGE_DIR={daemon._storage_dir}
    export KACHERY_P2P_CONFIG_DIR={daemon._config_dir}
    export KACHERY_TEMP_DIR={daemon._temp_dir}

    exec ./scripts/test_client_1.py
    ''')
    s.start()
    return s

def test_client_2(daemon):
    s = kp.ShellScript(f'''
    #!/bin/bash

    export KACHERY_P2P_API_PORT={daemon._port}
    export KACHERY_STORAGE_DIR={daemon._storage_dir}
    export KACHERY_P2P_CONFIG_DIR={daemon._config_dir}
    export KACHERY_TEMP_DIR={daemon._temp_dir}

    exec ./scripts/test_client_2.py
    ''')
    s.start()
    return s

def main():
    with kp.TemporaryDirectory() as tmpdir:
        d1 = TestDaemon(tmpdir=tmpdir, num=1)
        d2 = TestDaemon(tmpdir=tmpdir, num=2)
        daemons = [d1, d2]

        print('####################### starting the daemons')
        for d in daemons:
            d.start()

        try:
            s1 = test_client_1(d1)
            s2 = test_client_2(d2)

            while True:
                ret1 = s1.wait(1)
                ret2 = s2.wait(1)
                if ret1 is not None:
                    if ret1 != 0:
                        raise Exception('Problem in client 1')
                if ret2 is not None:
                    if ret2 != 0:
                        raise Exception('Problem in client 2')
                if (ret1 is not None) and (ret2 is not None):
                    break
        finally:
            print('####################### stopping the daemons')
            for d in daemons:
                d.stop()

if __name__ == '__main__':
    main()