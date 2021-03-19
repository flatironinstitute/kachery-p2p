import os

import kachery_p2p as kp
import numpy as np
from kachery_p2p._exceptions import LoadFileError


def main():
    test1()

    f = kp.load_feed('feed://' + os.environ['FEED_ID'])
    N1 = 10000
    N2 = 1000
    a = kp.store_npy(np.meshgrid(np.arange(N1), np.arange(N2))[0])
    sf = f.get_subfeed('sf1')
    sf.append_message({'a': a, 'N1': N1, 'N2': N2})

    # test invalid manifest
    b = kp.store_npy(np.meshgrid(np.arange(N1 + 1), np.arange(N2))[0])
    invalid_manifest = kp.store_json({'invalid': True})
    b_invalid_manifest = b.split('?')[0] + '?manifest=' + ka.get_file_hash(invalid_manifest)
    sf.append_message({'b_invalid_manifest': b_invalid_manifest})

def test1():
    f = kp.create_feed('f1')
    f2 = kp.load_feed('f1')
    assert(f.get_uri() == f2.get_uri())
    sf = f.get_subfeed('sf1')
    sf.append_message({'m': 1})
    assert(sf.get_num_messages() == 1)
    x = kp.store_text('abc')
    sf.set_access_rules({
        'rules': []
    })
    r = sf.get_access_rules()

    try:
        a = kp.load_file('sha1://e25f95079381fe07651aa7d37c2f4e8bda19727c/file.txt')
        raise Exception('Did not get expected error')
    except LoadFileError as err:
        pass # expected
    except Exception as err:
        raise err

if __name__ == '__main__':
    main()
