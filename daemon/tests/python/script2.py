import os
import time

import kachery_p2p as kp
import numpy as np

f = kp.load_feed('feed://' + os.environ['FEED_ID'])
sf = f.get_subfeed('sf1')
time.sleep(1)
messages = sf.get_next_messages(wait_msec=5000, max_num_messages=10)
assert(len(messages) == 2)
msg = messages[0]
a = msg['a']
A = kp.load_npy(a)
A2 = np.meshgrid(np.arange(msg['N1']), np.arange(msg['N2']))[0]
assert np.all(A == A2)

msg = messages[1]
b_invalid_manifest = msg['b_invalid_manifest']
try:
    A = kp.load_npy(b_invalid_manifest)
    raise Exception('Did not get expected error in kp.load_npy')
except Exception as e:
    if 'Invalid manifest file' not in str(e):
        raise Exception(f'Unexpected error: {str(e)}')
