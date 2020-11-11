import kachery_p2p as kp
import numpy as np

A = np.meshgrid(np.arange(10000), np.arange(1002))

a = 'sha1://1d671d3393b9f67a8f32af1b3dc6017caa96c8ee/file.npy?manifest=f72e9a974ea212b973b132e766802a21795a58db'
local_path = kp.load_file(a)
print(local_path)
A2 = kp.load_npy(a)

assert(np.all(A2 == A))
print('Success.')
