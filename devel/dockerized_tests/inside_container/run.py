#!/usr/bin/env python3

import os
import multiprocessing
import kachery_p2p as kp

class TestDaemon:
    def __init__(self, num: int) -> None:
        self._port = 10100 + num
        self._storage_dir = f'/kachery-storage-{num}'
        self._config_dir = f'/kachery-config-{num}'
        self._temp_dir = f'/kachery-temp-{num}'
        self._label = f'test-{num}'
        os.mkdir(self._storage_dir)
        os.mkdir(self._config_dir)
        os.mkdir(self._temp_dir)
    def start(self):
        p = multiprocessing.Process(target=_run_daemon, args=(self, ))
        p.start()
        self._wait_for_daemon_to_start()
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

def _run_daemon(daemon: TestDaemon):
    s = kp.ShellScript(f'''
    #!/bin/bash

    export KACHERY_P2P_API_PORT={daemon._port}
    export KACHERY_STORAGE_DIR={daemon._storage_dir}
    export KACHERY_P2P_CONFIG_DIR={daemon._config_dir}
    export KACHERY_TEMP_DIR={daemon._temp_dir}

    exec kachery-p2p-start-daemon --label {daemon._label}
    ''')
    s.start()
    s.wait()

def main():
    d1 = TestDaemon(1)
    d2 = TestDaemon(2)

    d1.start()
    d2.start()

if __name__ == '__main__':
    main()