"""
.. include:: ./documentation.md
"""

__version__ = "0.5.10"
__protocol_version__ = "0.5.9"

from typing import Iterable, List, Union

import numpy as np

from ._core import (_experimental_config, _find_file, _get_channels,
                    _get_node_id, _load_bytes, _load_file, _load_npy,
                    _load_object, _load_text, _store_file, _store_npy,
                    _store_object, _store_text, read_dir, start_daemon,
                    stop_daemon)
from ._exceptions import LoadFileError
from ._feeds import (create_feed, get_feed_id, load_feed, load_subfeed,
                     watch_for_new_messages)
from ._testdaemon import TestDaemon


def load_file(
    uri: str,
    dest: Union[str, None]=None,
    p2p: bool=True,
    from_node: Union[str, None]=None,
    from_channel: Union[str, None]=None
) -> Union[str, None]:
    """Load a file either from local kachery storage or from a remote kachery node

    Args:
        uri (str): The kachery URI for the file to load: sha1://...
        dest (Union[str, None], optional): Optional location to copy the file to. Defaults to None.
        p2p (bool, optional): Whether to search remote nodes. Defaults to True.
        from_node (Union[str, None], optional): Optionally specify which remote node to load from. Defaults to None.
        from_channel (Union[str, None], optional): Optionally specify which kachery channel to search. Defaults to None.

    Returns:
        Union[str, None]: If found, the local path of the loaded file, else None
    """
    return _load_file(uri=uri, dest=dest, p2p=p2p, from_node=from_node, from_channel=from_channel)

def load_bytes(uri: str, start: int, end: int, write_to_stdout=False, p2p: bool=True, from_node: Union[str, None]=None, from_channel: Union[str, None]=None) -> Union[bytes, None]:
    """Load a subset of bytes from a file in local storage or from remote nodes in the kachery network

    Args:
        uri (str): The kachery URI for the file to load: sha1://...
        start (int): The start byte (inclusive)
        end (int): The end byte (not inclusive)
        p2p (bool, optional): Whether to search remote nodes. Defaults to True.
        from_node (Union[str, None], optional): Optionally specify which remote node to load from. Defaults to None.
        from_channel (Union[str, None], optional): Optionally specify which kachery channel to search. Defaults to None.

    Returns:
        Union[bytes, None]: The bytes if found, else None
    """
    return _load_bytes(uri=uri, start=start, end=end, write_to_stdout=write_to_stdout, p2p=p2p, from_node=from_node, from_channel=from_channel)

def find_file(uri: str, timeout_sec: float=5) -> Iterable[dict]:
    """Find a file on the kachery-p2p network

    Args:
        uri (str): The kachery URI of the file: sha1://...
        timeout_sec (float, optional): The amount of time to wait for response from remote nodes

    Returns:
        Iterable[dict]: An iterable of the results of the above form. These may come back with a delay.
            One result for each peer on which the file has been found, plus one for self if found on the local node.
    
    .. include:: ./find_file.md
    """
    return _find_file(uri=uri, timeout_sec=timeout_sec)

def get_channels() -> List[str]:
    """Returns the list of names of channels that this node belongs to

    Returns:
        List[str]: The list of channel names
    """
    return _get_channels()

def load_object(uri: str, p2p: bool=True, from_node: Union[str, None]=None, from_channel: Union[str, None]=None) -> Union[dict, None]:
    """Load an object (Python dict) either from local kachery storage or from a remote kachery node

    Args:
        uri (str): The kachery URI for the file to load: sha1://...
        p2p (bool, optional): Whether to search remote nodes. Defaults to True.
        from_node (Union[str, None], optional): Optionally specify which remote node to load from. Defaults to None.
        from_channel (Union[str, None], optional): Optionally specify which kachery channel to search. Defaults to None.

    Returns:
        Union[dict, None]: If found, the Python dict, else None
    """
    return _load_object(uri=uri, p2p=p2p, from_node=from_node, from_channel=from_channel)

def load_text(uri: str, p2p: bool=True, from_node: Union[str, None]=None, from_channel: Union[str, None]=None) -> Union[str, None]:
    """Load a text string either from local kachery storage or from a remote kachery node

    Args:
        uri (str): The kachery URI for the file to load: sha1://...
        p2p (bool, optional): Whether to search remote nodes. Defaults to True.
        from_node (Union[str, None], optional): Optionally specify which remote node to load from. Defaults to None.
        from_channel (Union[str, None], optional): Optionally specify which kachery channel to search. Defaults to None.

    Returns:
        Union[str, None]: If found, the text string, else None
    """
    return _load_text(uri=uri, p2p=p2p, from_node=from_node, from_channel=from_channel)

def load_npy(uri: str, p2p: bool=True, from_node: Union[str, None]=None, from_channel: Union[str, None]=None) -> Union[np.ndarray, None]:
    """Load a Numpy array either from local kachery storage or from a remote kachery node

    Args:
        uri (str): The kachery URI for the .npy file to load: sha1://...
        p2p (bool, optional): Whether to search remote nodes. Defaults to True.
        from_node (Union[str, None], optional): Optionally specify which remote node to load from. Defaults to None.
        from_channel (Union[str, None], optional): Optionally specify which kachery channel to search. Defaults to None.

    Returns:
        Union[str, None]: If found, the Numpy array, else None
    """
    return _load_npy(uri=uri, p2p=p2p, from_node=from_node, from_channel=from_channel)

def store_file(path: str, basename: Union[str, None]=None) -> str:
    """Store file in the local kachery storage (will therefore be available on the kachery network) and return a kachery URI

    Args:
        path (str): Path of the file to store
        basename (Union[str, None], optional): Optional base file name to append to the sha1:// URI. Defaults to None.

    Returns:
        str: The kachery URI: sha1://...
    """
    return _store_file(path=path, basename=basename)

def store_object(object: dict, basename: Union[str, None]=None) -> str:
    """Store object (Python dict) in the local kachery storage (will therefore be available on the kachery network) and return a kachery URI

    Args:
        object (dict): The Python dict to store
        basename (Union[str, None], optional): Optional base file name to append to the sha1:// URI. Defaults to None.

    Returns:
        str: The kachery URI: sha1://...
    """
    return _store_object(object=object, basename=basename)

def store_text(text: str, basename: Union[str, None]=None) -> str:
    """Store text in the local kachery storage (will therefore be available on the kachery network) and return a kachery URI

    Args:
        text (str): The text string to store
        basename (Union[str, None], optional): Optional base file name to append to the sha1:// URI. Defaults to None.

    Returns:
        str: The kachery URI: sha1://...
    """
    return _store_text(text=text, basename=basename)

def store_npy(array: np.ndarray, basename: Union[str, None]=None) -> str:
    """Store Numpy array in the local kachery storage (will therefore be available on the kachery network) and return a kachery URI

    Args:
        array (np.ndarray): The Numpy array to store
        basename (Union[str, None], optional): Optional base file name to append to the sha1:// URI. Defaults to None.

    Returns:
        str: The kachery URI: sha1://...
    """
    return _store_npy(array=array, basename=basename)

def get_node_id(api_port=None) -> str:
    """Return the Node ID for this kachery node

    Args:
        api_port ([type], optional): Optionally override the port of the API daemon. Defaults to None.

    Returns:
        str: The node ID
    """
    return _get_node_id(api_port=api_port)
