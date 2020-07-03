import os
thisdir = os.path.dirname(os.path.realpath(__file__))
os.environ['KACHERY_STORAGE_DIR'] = thisdir + '/kachery-storage'
import kachery_p2p as kp
import kachery as ka

path = 'sha1://0bcfc4795a0ffc3c69b2ec30605ff2dfe95fe51f/file.json'

# path = 'sha1://ddda24849b34d954a14a7dc9631943c691c6bbe7/file.json'

for r in kp.find_file(path):
    print(r)

y = kp.load_file(path)
assert y is not None
txt = ka.load_text(y)
print(len(txt))