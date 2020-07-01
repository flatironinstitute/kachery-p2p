# kachery-p2p

Peer-to-peer file sharing using kachery.

## Overview

Kachery allows us to store files in a content-addressable storage database as in the following example:

```bash
#### Store a file in the local database ####
> kachery-store /path/to/file.dat
sha1://ad7fb868e59c495f355d83f61da1c32cc21571cf/file.dat

#### Load it later on ####
> kachery-load sha1://ad7fb868e59c495f355d83f61da1c32cc21571cf/file.dat --dest file.dat
file.dat
```

While it is possible to share these files between computers by hosting kachery storage servers, this is not always convenient, as it requires maintaining a running server and managing access. This `kachery-p2p` project allows you to share `kachery` folders using a distributed, peer-to-peer protocol.

In order to share files with another computer:

* The `kachery-p2p` daemon (with the same protocol version) must be running on both computers.
* The two daemon's must be joined to at least one common `kachery-p2p` channel.

## Installation

**Prerequisites**

* Linux or MacOS
* Docker

```
pip install --upgrade kachery-p2p
```

Be sure that the `KACHERY_STORAGE_DIR` environment is set and points to an existing directory.

## Starting the daemon

In order to share files, you must have a running daemon.

```bash
# Start the daemon and join one or more kachery-p2p channels
# Keep it running in a terminal
kachery-p2p daemon-start --channel name-of-channel --channel another-channel ...
```

Note: you can use any names for the channels. In order to share files with another computer, you must have at least one `kachery-p2p` channel in common.

## Sharing a file

```bash
# On your local computer
> kachery-store /path/to/file.dat
sha1://ad7fb868e59c495f355d83f61da1c32cc21571cf/file.dat
```

Send this kachery URL to your friend. The hash uniquely identifies your file inside this universe (with extremely high probability).

```bash
# On the remote computer
> kachery-p2p-load sha1://ad7fb868e59c495f355d83f61da1c32cc21571cf/file.dat --dest file.dat
```

## How it works

Each running `kachery-p2p` daemon is a node in the distributed kachery-p2p channel and has a public/private key pair. The ID of the node is equal to the public key.

The system is built on top of [hyperswarm](https://github.com/hyperswarm/hyperswarm) which allows peers to find and connect to one another.

`kachery-p2p` uses two types of hyperswarms: `lookup swarms` and `file transfer swarms`. The `lookup swarms` correspond to `kachery-p2p` channels and are used to determine which nodes contain which files. The `file transfer swarms` correspond to individual nodes and are used to perform the file transfer. Each node is the primary member of its own `file transfer swarm`. Other nodes can download files from the primary member by joining the swarm as secondary members.

Each node is a member of the following swarms:
* The lookup swarm `x` for each kachery-p2p channel `x` that the node belongs to
* The file transfer swarm `ID` where `ID` is the node ID, as a primary member
* Other file transfer swarms as needed for file download, as a secondary member

When a node wants to download a file with hash `h` it takes the following steps:
* Broadcasts a `seeking(h)` message to each lookup swarm it belongs to
* Waits for `providing(h)` messages
* If at least one `providing(h)` message is received
    - Chooses one of the nodes that is providing the file
    - Joins the file transfer swarm for that node
    - Tries to download the file in that file transfer swarm
    - If failure, try again for a different `providing(h)` message

When a node wants to share its files:
* Listens for `seeking(h)` messages on each lookup swarm it belongs to
* If `seeking(h)` message is received and we have the file with hash `h`, we broadcast a `providing(h)` message on that lookup swarm.
* Provides files for download on its own file transfer swarm.
