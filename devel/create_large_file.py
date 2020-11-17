import kachery_p2p as kp
import numpy as np

A = np.meshgrid(np.arange(500), np.arange(500), np.arange(100))
a = kp.store_npy(A)
print(a)
