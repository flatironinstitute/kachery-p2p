"""
.. include:: ./documentation.md
"""

__version__ = "0.5.13"
__protocol_version__ = "0.5.11p"

from typing import Iterable, List, Union

import numpy as np

from ._core import (_experimental_config, _find_file, _get_channels,
                    _get_node_id, _load_bytes, _load_file, _load_npy,
                    _load_object, _load_text, _store_file, _store_npy,
                    _store_object, _store_text, read_dir, start_daemon,
                    stop_daemon)
from ._exceptions import LoadFileError
from ._feeds import (_create_feed, _delete_feed, _get_feed_id, _load_feed,
                     _load_subfeed, _watch_for_new_messages)
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

################################################

def create_feed(feed_name: Union[str, None]=None):
    """Create a new local feed and optionally associate it with a local name

    Args:
        feed_name (Union[str, None], optional): Optional name for local retrieval. Defaults to None.

    Returns:
        Feed: The newly-created local writeable feed
    """
    return _create_feed(feed_name=feed_name)

def delete_feed(feed_name_or_uri: str) -> None:
    """Delete a feed with a particular name or URI

    Args:
        feed_name_or_uri (str): The name or URI of the feed to delete
    """
    return _delete_feed(feed_name_or_uri=feed_name_or_uri)    

def get_feed_id(feed_name: str, *, create: bool=False) -> Union[None, str]:
    """Return the ID of a feed by name, and optionally create a new feed if it does not exist

    Args:
        feed_name (str): The local name of the feed ID to retrieve
        create (bool, optional): Whether to create a new feed if none exists with this name. Defaults to False.

    Returns:
        Union[None, str]: The feed ID, if exists, else None
    """
    return _get_feed_id(feed_name=feed_name, create=create)

def load_subfeed(subfeed_uri: str):
    """Load a subfeed by URI

    Args:
        subfeed_uri (str): the URI of the subfeed

    Returns:
        Subfeed: The subfeed associated with the URI
    """
    return _load_subfeed(subfeed_uri=subfeed_uri)
        
def load_feed(feed_name_or_uri: str, *, timeout_sec: Union[None, float]=None, create=False):
    """Load a feed by URI or local name

    Args:
        feed_name_or_uri (str): Either the local name or the URI of the feed to load
        timeout_sec (Union[None, float], optional): An optional timeout for searching for the feed. Defaults to None.
        create (bool, optional): Whether to create if doesn't exist (only applies when supplying a local feed name). Defaults to False.

    Returns:
        Feed: The loaded feed
    """
    return _load_feed(feed_name_or_uri=feed_name_or_uri, timeout_sec=timeout_sec, create=create)

def watch_for_new_messages(subfeed_watches: List[dict], *, wait_msec) -> List[dict]:
    """Watch for new messages on one or more subfeeds

    Args:
        subfeed_watches (List[dict]): A list of subfeed watches (TODO: more details needed)
        wait_msec ([type]): The wait duration for retrieving the messages

    Returns:
        List[dict]: The list of retrieved messages (TODO: more details needed)
    """
    return _watch_for_new_messages(subfeed_watches=subfeed_watches, wait_msec=wait_msec)
