import kachery_p2p as kp
import numpy as np

A, B, C = np.meshgrid(np.arange(500), np.arange(500), np.arange(300))
a = kp.store_npy(A)
print(a)
