# kachery-p2p

**Important: The kachery-p2p protocol has recently changed. Old versions of the daemon software may no longer work properly. Please update to the latest version.**

**This project is still at an early stage of development. We welcome contributors and testers**

Current version: `kachery-p2p 0.5.13`
Current protocol version: `kachery-p2p 0.5.11p`

Kachery-p2p is a **peer-to-peer, content-addressable file storage and distribution framework** which can operate with minimal infrastructural requirements and offers both command-line and programmatic interfaces to file distribution. In short, it’s a way for you to distribute your data to collaborators with minimal fuss.

## Getting started

* [Setup and installation](./doc/setup_and_installation.md)

* [User's guide](https://htmlpreview.github.io/?https://github.com/flatironinstitute/kachery-p2p/blob/main/doc/html/kachery_p2p/index.html) - Python API, basic usage

* [Instructions for beta testers](./doc/beta_testing_instructions.md)

## Motivation

Kachery-p2p has advantages for scientific communities that share large datasets. It is often inconvenient (and expensive) for individual labs to host such datasets. The idea of kachery-p2p is to relieve this burden by making it easy to share a data file with a community or individuals by submitting it to the distributed system. The simplest way to share a snapshot (or copy) of a file is:

```
kachery-store /my/large-or-small/file.dat
```

Then distribute the unique kachery URI (identifier) to colleagues. For example, you could just paste the URI into a python script or a github README file.

You also need to be running a kachery daemon on your computer (sort of like a dropbox daemon) and choose a channel name for distribution. But once another person (on your kachery channel) has the file, it's okay if you don't seed it any more. In this way it is similar to [BitTorrent](https://www.bittorrent.com/) or the [Dat Protocol](https://www.datprotocol.com/).

There is also a very nice integration with python where you can share NumPy arrays (or other files) with minimal effort:

```python
import kachery_p2p as kp
uri = kp.store_npy(X)

# Then on a different computer
X = kp.load_npy(uri)
```

This is just the beginning of the capabilities. Because it is meant to power the SpikeForest analysis pipeline and other web-based visualization tools, kachery-p2p supports sharing of live feeds (in addition to static content). This enables powerful functionality like running analysis jobs on a remote compute resource and creating universal (reproducible) scripts that can run from anywhere. The work of transferring input/output files to/from the remote resource is automatically handled by the p2p system and the communication (job submission) is handled via the kachery live feeds.

### Why not sftp, rsync, google drive, or just a web server?

With kachery, no central node is required. Anyone on the network can begin sharing data by setting up a channel and encouraging others to subscribe to it. Snapshots of files can be stored (initially) on the machines where they are generated, and distributed directly without paying for or maintaining a new server. This is especially advantageous when multiple peers are collaborating: everyone can produce data and store it locally, without needing to have a central server as a bottleneck. Servers are expensive, and building a central repository of all files is especially cumbersome when many files are only needed by a subset of the collaborators. The peer-to-peer model gets around both these challenges. Moreover, distributed networks are more resilient to the loss of individual nodes: if the FTP server is down, no one can get the files; but so long as one copy is visible on the peer-to-peer network (someone’s computer), it can still be spread to the parties who need to consume it.

### Why not BitTorrent?

Kachery-p2p seeks to provide many of the same features that a conventional solution like BitTorrent would offer, and this (or perhaps [resilio sync](https://www.resilio.com/individuals/)) is the closest similar software package in the ecosystem. However, kachery offers several other key features:

* Simple addressing scheme. Kachery is designed as content-addressable storage in that files are universally locatable by SHA1-based fingerprints.
* Python integration with an emphasis on data science and supports portable analysis pipelines using a companion tool called hither.
* Entirely distributed. There is no requirement for a central “tracker” which registers files available on the network. (We do provide a matchmaking bootstrap server for initial peer discovery.)
* File security model. Files in kachery are made available to specific channels. To have access to a file, a user must belong to the same channel as someone sharing the file. Thus, kachery-based file distribution can be restricted to a subset of the entire kachery network.
* Feeds (collections of append-only logs). In addition to file distribution, kachery-p2p also provides features to facilitate ongoing communication between peers. This is achieved through the medium of feeds, which function like a journal to which other channel members subscribe. One use case for the feed is to record a series of modifications to a data file, and ensure that subscriber peers can replay the same actions to reach a state that is consistent with the state on the feed source.

In addition, many ISPs actively block traffic using the BitTorrent protocol’s standard channels. Kachery-p2p uses various hole-punching techniques, along with per-transfer port negotiation, to encourage a seamless connection between peers. Furthermore, traffic can be routed through a proxy server if the direct peer-to-peer communication fails.

## Concepts

### Channels

A “channel” is a means of creating a communication subgroup among the peers on the kachery-p2p network. If multiple peers are subscribed to the same channel, they can share files and feeds that are available over that channel; and peers do not need to pay attention to any messages directed outside the channels they are subscribed to. This is essentially a restricted peer community.

### File Storage

Files in kachery may be stored on any disk accessible from a computer where a kachery daemon is running. Within the kachery-storage directory, data files are recorded according to their SHA-1 hash, making them easy to locate and providing an obvious checksum to ensure successful file transfer/file integrity. Feeds (collections of append-only logs) are similarly stored according to their unique public key.

### Feeds

A “feed” is a collection of write-only journals (or append-only logs) which can be shared between different peers on the network. Unlike static files, they can be amended over time, and applications may subscribe to changes to get real-time updates. This enables peer-to-peer communication between application components using the same network and channel mechanisms as file transfer.

### File Transfer

Kachery-p2p can transfer arbitrary files, and also serializes NumPy data from memory when used with the python programmatic interface.

From command line (in a separate terminal):

```bash
kachery-store /path/to/your/file.dat
```

This will copy the file to the kachery storage directory and will display a SHA1 URI, which you can then share with your collaborators. The file can then be retrieved from any computer running a kachery-p2p daemon on the same channel:

```
kachery-p2p-load sha1://012...abc/file.dat --dest file.dat
```

### From python:

Where kachery really shines is in managing files that you want to manipulate in scripts. In fact, you can even hand off NumPy arrays from one machine to another seamlessly.

```python
import kachery_p2p as kp
import numpy as np

filename = ‘/some/path/and/file.txt’
with open(filename, ‘w’) as fh:
	fh.write(“Here is my message”)
sha1 = kp.store_file(filename)
print(sha1) # this can now be shared with a collaborator

# An equivalent shortcut for this is:
kp.store_text("Here is my message")

# You can also store python dicts or numpy arrays
kp.store_object(dict(text="some text"))
kp.store_npy([1, 2, 3])
```


Then, on your collaborator’s computer:

```python
import kachery_p2p as kp
import numpy as np
p = ‘sha1://....’ # paste in value from first party
that_file = kp.load_file(p)
with open(that_file, ‘r’) as fh:
	print(fh.readlines())

# Or an equivalent shortcut
txt = kp.load_text(p)
```

For an example of numpy data sharing:

```python
import kachery_p2p as kp
import numpy as np

A = np.random.normal(0, 1, (3, 3))
x = np.array([[3], [4], [5]])
B = A.dot(x)
pA = kp.store_npy(A)
pB = kp.store_npy(B)
```

Share those hashes with your collaborator, and they run:

```python
import kachery_p2p as kp
import numpy as np
import numpy.linalg as lin

sha1_A = ‘sha1://...value_from_collaborator’
sha1_B = ‘sha1://...also_from_collaborator’
A = kp.load_npy(sha1_A)
B = kp.load_npy(sha1_B)
recovered_x = lin.solve(A, B)

print(recovered_x)

# [[3.] [4.] [5.]]
```

## Primary developers

Jeremy Magland and Jeff Soules, Center for Computational Mathematics, Flatiron Institute