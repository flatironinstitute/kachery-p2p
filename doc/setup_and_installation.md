# kachery-p2p setup & installation

## Requirements

POSIX environment (Linux or Mac--currently tested with Ubuntu 16.04 and 18.04)

We recommend that you use a Conda environment with

* Python >= 3.7
* NumPy
* Nodejs >=12 (available on conda-forge)

## Installation using Conda

```bash
export KACHERY_STORAGE_DIR=/desired/file/storage/location
# also add that to .bashrc or wherever you keep your env vars

conda create --name MYENV python=3.8 numpy>=1.19.0
conda activate MYENV
conda install -c conda-forge nodejs
pip install --upgrade kachery_p2p
```

Or you could use the `environment.yaml` file included in this repo to create a new conda environment, and then use `pip` to install kachery_p2p as above in the new environment.
(To create an environment from file, execute `conda env create -f environment.yaml`. The included yaml file will create an environment called `kachery_p2p_env`.)

## Installation without conda

It is also possible to install without conda. Just make sure that the above requirements are met on your system, and then `pip install --upgrade kachery_p2p` as above.

## Running the daemon

Ensure you are in the correct conda environment, then:

```bash
kachery-p2p-start-daemon --label <name-of-node> --config <url-or-path-to-yaml-file>
```

where `<name-of-node>` is a node label for display purposes and `<url-or-path-to-yaml-file>` points to a configuration file. To get started you may use this example configuration file:
`https://gist.githubusercontent.com/magland/9b858ee9dae97db9879826316fa2ba52/raw/kachery-example1.yaml`

This example configuration points to a couple of bootstrap nodes which are used to assist with node discovery and specifies that we join a couple of channels including the `example1-zXk8tk` channel. Any other node configured with this same file will become a member of these same channels.

Keep this daemon running in a terminal. You may want to use [tmux](https://github.com/tmux/tmux/wiki) or a similar tool to keep this daemon running even if the terminal is closed.

Other more advanced options are available, such as specifying listen ports (see below).

## Advanced configuration

Environment variables

* `KACHERY_STORAGE_DIR` - should refer to an existing directory on your local computer. This is where kachery stores all of your cached files.
* `KACHERY_P2P_API_PORT` **(optional)** - Port that the Python client uses to communicate with the daemon. If not provided, a default port will be used.
* `KACHERY_P2P_CONFIG_DIR` **(optional)** - Directory where configuration files will be stored, including the public/private keys for your node on the distributed system. The default location is ~/.kachery-p2p

## Hosting a bootstrap node

In order for peers to find one another, they need to connect to a common bootstrap server. In the example above, we provide a couple of bootstrap nodes. You are welcome to use these in your own channels. But you can also host your own bootstrap node(s).

To create your own bootstrap node, install kachery-p2p on a computer in the cloud with two accessible ports, one for http and one for websocket. The ports must be open to tcp connections and the http port must also accept udp connections. Start the bootstrap daemon with the following command:

```bash
kachery-p2p-start-daemon --label <bootstrap-label> --isbootstrap --i
smessageproxy --host <ip-or-hostname> --port <http-listen-port> --websocket-port <websocket-listen-port>
```

You can then create a .yaml configuration file github gist (as above) that points to this node as a bootstrap, using the `<ip-or-hostname>` and the `<listen-port>`.

You may want to use [tmux](https://github.com/tmux/tmux/wiki) or a similar tool to keep this daemon running even if the terminal is closed. This gives you the ability to reattach from a different terminal at a later time.