import kachery_p2p as kp

kp.set([{'some': 'key'}, 1], 'val1')
kp.set([{'some': 'key'}, 2], 'val2')
a = kp.get([{'some': 'key'}, 1])
b = kp.get([{'some': 'key'}, 2])
print(a, b)