# kachery-p2p setup & installation

## Requirements

Tested on Linux, should also work on macOS and Windows Subsystem for Linux

We recommend that you use a Conda environment with

* Python 3.8
* NumPy
* Nodejs >=12 (available on conda-forge; see below)

## Installation using Conda

```bash
conda create --name kachery-p2p-env python=3.8 numpy>=1.19.0
conda activate kachery-p2p-env

conda install -c conda-forge nodejs
pip install --upgrade kachery_p2p

# On macOS you may need to use the following to get a recent version of nodejs (>=12):
# conda install nodejs -c conda-forge --repodata-fn=repodata.json
```

## Installation without conda

It is also possible to install without conda. Just make sure that the above requirements are met on your system, and then `pip install --upgrade kachery_p2p` as above.

## Running the daemon

Ensure you are in the correct conda environment, then:

```bash
kachery-p2p-start-daemon --label <name-of-node>
```

where `<name-of-node>` is a node label for display purposes.


Keep this daemon running in a terminal. You may want to use [tmux](https://github.com/tmux/tmux/wiki) or a similar tool to keep this daemon running even if the terminal is closed.

Other more advanced options are available, such as specifying listen ports (see below).

## Joining a channel

A channel is defined by a github gist. Anyone with a github account can create a channel. You can join a channel by running the following command:

```bash
kachery-p2p-join-channel https://gist.githubusercontent.com/<user>/<id>/raw/<file-name>.yaml
```

where `<user>`, `<id>` and `<file-name>` should be filled in to point to your gist. You can get this URL from github by clicking on the "Raw" button when viewing the gist.

Here is an example gist defining the `ccm-test` channel: https://gist.githubusercontent.com/magland/542b2ef7c268eb99d87d7b965567ece0/raw/ccm-test-channel.yaml

The channel config file contains the channel label (for display purposes), a set of bootstrap servers (for peer discovery) and a list of authorized nodes. Your node ID must appear on this list of authorized nodes in order to join the channel. To allow a colleague to join the channel, you can add their node information to the config gist.

## Advanced configuration

Environment variables for the daemon

* `KACHERY_STORAGE_DIR` **(optional)** - Refers to an existing directory on your local computer. This is where kachery stores all of your cached files. If not set, files will be stored in the default location: `$HOME/kachery-storage`.
* `KACHERY_P2P_API_PORT` **(optional)** - Port that the Python client uses to communicate with the daemon. If not provided, a default port will be used.
* `KACHERY_P2P_CONFIG_DIR` **(optional)** - Directory where configuration files will be stored, including the public/private keys for your node on the distributed system. The default location is ~/.kachery-p2p

Environment variables for the client

* `KACHERY_P2P_API_PORT` **(optional)** - same as above
* `KACHERY_P2P_API_HOST` **(optional)** - same as above
* `KACHERY_TEMP_DIR` **(optional)** - Existing directory where temporary files are stored - not the same as `KACHERY_STORAGE_DIR`.


## Hosting a bootstrap node

In order for peers to find one another, they need to connect to a common bootstrap server. In the example above, we provide a couple of bootstrap nodes. You are welcome to use these in your own channels. But you can also host your own bootstrap node(s).

To create your own bootstrap node, install kachery-p2p on a computer in the cloud with two accessible ports, one for http and one for websocket. The ports must be open to tcp connections and the http port must also accept udp connections. Start the bootstrap daemon with the following command:

```bash
kachery-p2p-start-daemon --label <bootstrap-label> --isbootstrap --host <ip-or-hostname> --port <http-listen-port> --websocket-port <websocket-listen-port>
```

You can then create a channel .yaml configuration file github gist (as above) that points to this node as a bootstrap, using the `<ip-or-hostname>` and the `<http-listen-port>`.

You may want to use [tmux](https://github.com/tmux/tmux/wiki) or a similar tool to keep this daemon running even if the terminal is closed. This gives you the ability to reattach from a different terminal at a later time.
