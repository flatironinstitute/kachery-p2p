import kachery_p2p as kp
import numpy as np

A, B, C = np.meshgrid(np.arange(501), np.arange(502), np.arange(303))
a = kp.store_npy(A)
print(a)
