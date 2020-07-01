import os
thisdir = os.path.dirname(os.path.realpath(__file__))
os.environ['KACHERY_STORAGE_DIR'] = thisdir + '/kachery-storage'
import kachery_p2p as kp

# swarm_names = kp.daemon.get_swarm_names()
# print(swarm_names)

# x = kp.load_file('sha1://7da2a66f0091de95d03b9faec833c56de3f45b66/.gitignore', _debug=True)
# print(x)

for r in kp.find_file('sha1://7da2a66f0091de95d03b9faec833c56de3f45b66/.gitignore'):
    print(r)

y = kp.load_file('sha1://7da2a66f0091de95d03b9faec833c56de3f45b66/.gitignore')
print(y)