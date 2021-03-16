#!/usr/bin/env python

import os
import time

from kachery_p2p import TestDaemon
from kachery_p2p._temporarydirectory import TemporaryDirectory


def main():
    try:
        with TemporaryDirectory() as tmpdir:
            channels = ['benchmark1']
            d1 = TestDaemon(
                label='d1',
                channels=channels,
                api_port=50401,
                storage_dir=str(tmpdir) + f'/test_storage_{_randstr(5)}',
                port=60401,
                bootstraps=None
            )
            d1.start()
            with d1.testEnv():
                import kachery_p2p as kp
                uri = kp.store_text(_randstr(40000000))
            
            d2 = TestDaemon(
                label='d2',
                channels=channels,
                api_port=50402,
                storage_dir=str(tmpdir) + f'/test_storage_{_randstr(5)}',
                port=60402,
                bootstraps=None
            )
            d2.start()
            time.sleep(5)
            with d2.testEnv():
                import kachery_p2p as kp
                timer = time.time()
                txt = kp.load_text(uri)
                assert txt is not None
                elapsed = time.time() - timer
                print(f'================ Elapsed: {elapsed}')
    finally:
        d1.stop()
        d2.stop()


def _randstr(n):
    import random
    import string
    return ''.join(random.choice(string.ascii_lowercase) for _ in range(n))

if __name__ == '__main__':
    main()
