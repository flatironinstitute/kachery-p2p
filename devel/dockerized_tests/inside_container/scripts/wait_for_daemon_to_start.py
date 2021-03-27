#!/usr/bin/env python3

import time
import kachery_p2p as kp

def main():
    timeout_sec = 30
    
    print('Waiting for daemon to start...')
    timer = time.time()
    while True:
        try:
            kp.get_node_id()
            elapsed = time.time() - timer
            print(f'Daemon started after {elapsed} seconds')
            break
        except:
            pass
        elapsed = time.time() - timer
        if elapsed > timeout_sec:
            raise Exception(f'Timeout while waiting for daemon to start ({elapsed} seconds)')

if __name__ == '__main__':
    main()