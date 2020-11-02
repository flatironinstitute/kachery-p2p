import kachery_p2p as kp
import numpy as np

A = np.meshgrid(np.arange(10000), np.arange(1002))
a = kp.store_npy(A)
print(a)
