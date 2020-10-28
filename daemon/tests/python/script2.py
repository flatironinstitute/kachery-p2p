import os

import kachery_p2p as kp
import numpy as np

f = kp.load_feed('feed://' + os.environ['FEED_ID'])
sf = f.get_subfeed('sf1')
messages = sf.get_next_messages(wait_msec=5000, max_num_messages=10)
assert(len(messages) == 1)
a = messages[0]['a']
A = kp.load_npy(a)
A2 = np.meshgrid(np.arange(1000), np.arange(1000))[0]
assert np.all(A == A2)
