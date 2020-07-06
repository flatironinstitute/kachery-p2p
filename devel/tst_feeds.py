#!/usr/bin/env python

import kachery_p2p as kp
import random

x = kp.load_feed('testfeed2', create=True)
print(x.get_path())

msg = {'rand': random.random()}
x.append_messages([msg])

msgs = x.get_messages()
print(len(msgs))
print(msgs[-1])
assert msgs[-1]['rand'] == msg['rand']
# for a in x.get_messages():
#     print(a)