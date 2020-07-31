# kachery-p2p

Peer-to-peer file sharing using [kachery](https://github.com/flatironinstitute/kachery).

## Overview

Kachery allows us to store files in a content-addressable storage database as in the following example:

```bash
# Store a file in the local database
> kachery-store /path/to/file.dat
sha1://ad7fb868e59c495f355d83f61da1c32cc21571cf/file.dat

# Load it later on
> kachery-load sha1://ad7fb868e59c495f355d83f61da1c32cc21571cf/file.dat --dest file.dat
file.dat
```

While it is possible to share these files between computers by hosting kachery storage servers, this is not always convenient, as it requires maintaining a running server and managing access. The `kachery-p2p` project allows you to share `kachery` files using a distributed, peer-to-peer protocol.

In order to share files with another computer:

* Run the `kachery-p2p` daemon on both computers
* Ensure that both daemons have at least one *channel* in common
* Files stored in your local kachery database will be accessible from the other computer and vice versa

## Installation

**Prerequisites**

* Linux or MacOS
* NodeJS version >=12 (to run the daemon)

```
pip install --upgrade kachery-p2p
```

## Configuration

Environment variables

* `KACHERY_STORAGE_DIR` - should refer to an existing directory on your local computer. This is where kachery stores all of your cached files.
* `KACHERY_P2P_API_PORT` **(optional)** - Port that the Python client uses to communicate with the daemon. If not provided, a default port will be used.
* `KACHERY_P2P_CONFIG_DIR` **(optional)** - Directory where configuration files will be stored, including the public/private keys for your node on the distributed system. The default location is ~/.kachery-p2p

## Starting the daemon

In order to share and/or access files, you must have a running daemon.

```bash
# Start the daemon and keep it running in a terminal
kachery-p2p-start-daemon
```

You may want to use [tmux](https://github.com/tmux/tmux/wiki) or a similar tool to keep this daemon running even if the terminal is closed. This gives you the ability to reattach from a different terminal at a later time.

## Joining channels

To join a `kachery-p2p` channel:

```bash
# Use any name you want for the channel
kachery-p2p-join-channel name-of-channel
```

You can use any name for the channel. Two computers can share files if they have running daemons with at least one channel in common.

List the current channels:

```bash
kachery-p2p-get-channels
```

Leave a channel:

```bash
kachery-p2p-leave-channel name-of-channel
```

## Sharing a file

```bash
# On your local computer
> kachery-store /path/to/file.dat
sha1://e0a72ba2311e36b60039ff643781a3eb43b23639/file.dat
```

Send this kachery URL to your friend. The hash uniquely identifies your file inside our universe (with extremely high probability).

```bash
# On the remote computer
> kachery-p2p-load sha1://e0a72ba2311e36b60039ff643781a3eb43b23639/file.dat --dest file.dat
```

If it is a text file, you can write the contents to stdout:

```bash
kachery-p2p-cat sha1://e0a72ba2311e36b60039ff643781a3eb43b23639/file.dat
```

It is also possible to find files without downloading them:

```bash
kachery-p2p-find sha1://e0a72ba2311e36b60039ff643781a3eb43b23639/file.dat
```

## Python API

It is also possible to use the Python API directory. For example:

```python
import kachery_p2p as kp

local_path = kp.load_file('sha1://e0a72ba2311e36b60039ff643781a3eb43b23639/file.dat')
if local_path is not None:
    print(f'File downloaded to: {local_path}')
```

## How it works

Each running `kachery-p2p` daemon is a node in the distributed kachery-p2p network and has a unique public/private key pair. The ID of the node is equal to the public key. The system allows peers that share a common channel to find and connect to one another.


## Authors

Jeremy Magland and Jeff Soules, Center for Computational Mathematics, Flatiron Institute