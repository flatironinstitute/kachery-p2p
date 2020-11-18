This is the Python API documentation for [kachery-p2p](https://github.com/flatironinstitute/kachery-p2p), auto-generated using [pdoc3](https://pdoc3.github.io/pdoc/doc/pdoc/#gsc.tab=0).

### Example 1: text (storage and retrieval)

You must be running a kachery-p2p daemon on your computer.

Store a text file in your local kachery storage:

```python
import kachery_p2p as kp

uri = kp.store_text("Here is my message")
print(uri)
# sha1://58c3a504f91dab6ade375c69d9f78e312520f1b4/file.txt
```

Then, on your collaborator’s computer (must be joined to a common kachery-p2p channel):

```python
import kachery_p2p as kp

uri = 'sha1://58c3a504f91dab6ade375c69d9f78e312520f1b4/file.txt'
txt = kp.load_text(uri)
print(txt)
# Here is my message
```

### Example 2: dict (storage and retrieval)

You must be running a kachery-p2p daemon on your computer.

Store a Python dict in your local kachery storage:

```python
import kachery_p2p as kp

uri = kp.store_object({'name': 'example-object'})
print(uri)
# sha1://af0fa33ccfec88a593504bbc34b40099325a7c1d/file.json
```

Then, on your collaborator’s computer (must be joined to a common kachery-p2p channel):

```python
import kachery_p2p as kp

uri = 'sha1://af0fa33ccfec88a593504bbc34b40099325a7c1d/file.json'
obj = kp.load_object(uri)
print(obj)
# {'name': 'example-object'}
```

### Example 3: Numpy array (storage and retrieval)

You must be running a kachery-p2p daemon on your computer.

Store a Numpy array in your local kachery storage:

```python
import kachery_p2p as kp
import numpy as np

uri = kp.store_npy(np.array([[1, 2], [3, 4], [5, 6]]))
print(uri)
# sha1://d37c5a82bbd344493af1ce6a1ac2b967d2490927/file.npy
```

Then, on your collaborator’s computer (must be joined to a common kachery-p2p channel):

```python
import kachery_p2p as kp

uri = 'sha1://d37c5a82bbd344493af1ce6a1ac2b967d2490927/file.npy'
X = kp.load_npy(uri)
print(X)
# [[1 2] [3 4] [5 6]]
```

### Example 4: arbitrary file (storage and retrieval)

You must be running a kachery-p2p daemon on your computer.

Store a file in your local kachery storage:

```python
import kachery_p2p as kp

uri = kp.store_file('README.md')
print(uri)
# sha1://22c41bfff16381e7fe327539e6cda2fab2a8e8ad/README.md
```

Then, on your collaborator’s computer (must be joined to a common kachery-p2p channel):

```python
import kachery_p2p as kp

uri = 'sha1://22c41bfff16381e7fe327539e6cda2fab2a8e8ad/README.md'
X = kp.load_file(uri)
print(X)
# /home/user/kachery-storage/sha1/22/c4/1b/22c41bfff16381e7fe327539e6cda2fab2a8e8ad
```

### Example 5: load part of a file

In the previous example, suppose we wanted to read only bytes `357-420`:

```python
import kachery_p2p as kp

uri = 'sha1://22c41bfff16381e7fe327539e6cda2fab2a8e8ad/README.md'
X = kp.load_bytes(uri, start=357, end=421)
print(X.decode())
# Kachery-p2p is a **peer-to-peer, content-addressable file s
```

