## kachery-p2p reference documentation

Kachery-p2p comprises a Python client, a command-line interface, and a daemon server.

## Kachery-p2p daemon

Although some kachery-p2p client operations can be used without a running daemon, it is recommended that you maintain a running kachery-p2p daemon when using kachery-p2p. Instructions for starting the daemon can be found [here](./setup_and_installation.md).

## Python client connecting to the kachery-p2p daemon

The Python client can operate in two different situations

1. Connected to a running daemon (online mode)
2. Not connected to a running daemon (offline mode)

Offline mode occurs when the client is not able to connect to a running daemon service (either no daemon is running on the local machine or it is running on a port that is different from the configured port). The kachery-p2p client will check periodically whether a connection can be established. By default it checks for a local daemon process listening on port 20431, but this can be overridden using the `KACHERY_P2P_API_PORT` environment variable.

## Offline mode

In offline mode, the `KACHERY_STORAGE_DIR` environment variable must be set to the absolute path of an existing directory. This is where all data files will be stored.

The following kachery-p2p commands **can** be run in offline mode (but will only have access to the data stored in the local `${KACHERY_STORAGE_DIR}`): `kp.store_file()`, `kp.store_text()`, `kp.store_object()`, `kp.store_npy()`, `kp.load_file()`, `kp.load_text()`, `kp.load_object()`, `kp.load_npy()`.

The following kachery-p2p commands **cannot** be run in offline mode: `kp.load_feed()`, `kp.create_feed()`, and all of the other feed operations; `kp.get_node_id()`, `kp.get_channels()`. These functions will all throw exceptions if the client is not connected to a daemon.

When in offline mode, the `kp.load_*()` and `kp.store_*()` commands read and write directly to the `$KACHERY_STORAGE_DIR`. If this environment variable is not set, an exception is raised one one of these functions is called.

## Online mode

When a daemon is running and the client is connected to the daemon (i.e., in online mode), it is not necessary for the `KACHERY_STORAGE_DIR` environment variable to be set because the location of this directory is communicated from the daemon to the client. If this variable *is* set, but is inconsistent with the storage directory of the daemon, then kachery will raise an exception.

When in online mode, the load functions (e.g., `kp.load_file()`) will first check the `$KACHERY_STORAGE_DIR` directly for the file. If not found, it will consult with the daemon, which may retrieve the file from the kachery network.

The save functions (e.g., `kp.save_file()`) behave differently depending on whether the `KACHERY_STORAGE_DIR` variable is set for the client. In both cases the client will first compute the file hash and check `$KACHERY_STORAGE_DIR` to see if the file is already stored. If so, the function will be a no-op. Otherwise, if the environment variable is set, then the client will attempt to store the file directly to the storage directly without consulting the daemon. If the variable is not set, then the client will first consult with the daemon to determine whether the file needs to be stored. If so, the client will stream the data to the daemon and the daemon will be responsible for storing the data in the proper storage location.

## Recommendation for multiple users sharing the same computer

If multiple users are sharing the same machine, then it is recommended that one of the users (or perhaps a service user) maintains the running daemon, and that the KACHERY_STORAGE_DIR is set to a directory that is readable (but not writeable) by all users. The individual do not need to set any environment variables, and in particular should **not** set the KACHERY_STORAGE_DIR.
