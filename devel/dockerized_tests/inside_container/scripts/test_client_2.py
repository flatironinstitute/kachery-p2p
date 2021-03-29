#!/usr/bin/env python3

import time
import kachery_p2p as kp

def main():
    uri = kp.store_text('123')
    a = kp.load_text(uri)
    assert a == '123'

if __name__ == '__main__':
    main()