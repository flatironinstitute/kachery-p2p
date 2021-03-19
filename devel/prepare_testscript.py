import os
thisdir = os.path.dirname(os.path.realpath(__file__))
os.environ['KACHERY_STORAGE_DIR'] = thisdir + '/kachery-storage-other'
import kachery_p2p as kp

uri = kp.store_json(dict(test=[a for a in range(20000000)])) # sha1://0bcfc4795a0ffc3c69b2ec30605ff2dfe95fe51f/file.json
# uri = kp.store_json(dict(test=[a for a in range(1000000)])) # sha1://ddda24849b34d954a14a7dc9631943c691c6bbe7/file.json

print(uri)