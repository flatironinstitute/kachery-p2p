import hashlib
import json
import time
from os import wait
from os.path import basename
from typing import Union
from urllib.parse import quote, unquote

import kachery as ka

from ._core import _api_port, _http_post_json, _load_object


class Feed:
    def __init__(self, uri, *, timeout_sec: Union[None, float]=None):
        if '://' not in uri:
            uri = f'feed://{uri}'
        self._feed_uri = uri
        self._timeout_sec = timeout_sec
        if uri.startswith('feed://'):
            feed_id, subfeed_name, position = _parse_feed_uri(uri)
            if subfeed_name is not None:
                raise Exception('Cannot specify subfeed name in URI when loading feed')
            self._feed_id = feed_id
            self._feed_node_id = None
            self._is_writeable = None
            self._is_snapshot = False
            self._initialize()
        elif uri.startswith('sha1://'):
            # snapshot
            self._feed_id = None
            self._feed_node_id = None
            self._is_writeable = False
            self._is_snapshot = True
            self._snapshot_object = _load_object(uri)
            assert self._snapshot_object is not None, f'Unable to load snapshot: {uri}'
        else:
            raise Exception(f'Unexpected feed uri: {uri}')
    def _initialize(self):
        port = _api_port()
        url = f'http://localhost:{port}/feed/getFeedInfo'
        x = _http_post_json(url, dict(
            feedId=self._feed_id,
            timeoutMsec=(self._timeout_sec if self._timeout_sec is not None else 1) * 1000
        ))

        assert x['success'], f'Unable to initialize feed: {self._feed_id} ({x["error"]})'
        self._feed_node_id = x['nodeId']
        self._is_writeable = x['isWriteable']
    def is_writeable(self):
        return self._is_writeable
    def get_feed_id(self):
        return self._feed_id
    def get_feed_node_id(self):
        return self._feed_node_id
    def get_uri(self):
        return self._feed_uri
    def is_snapshot(self):
        return self._is_snapshot
    def get_subfeed(self, subfeed_name, position=0):
        return Subfeed(feed=self, subfeed_name=subfeed_name, position=position)
    def delete(self):
        _delete_feed(self.get_uri())
    def create_snapshot(self, subfeed_names: list):
        subfeeds = dict()
        for subfeed_name in subfeed_names:
            subfeed = self.get_subfeed(subfeed_name)
            messages = subfeed.get_next_messages(wait_msec=0)
            subfeeds[subfeed.get_subfeed_hash()] = dict(
                subfeedHash=subfeed.get_subfeed_hash(),
                messages=messages
            )
        snapshot_uri = ka.store_object(dict(
            subfeeds=subfeeds
        ), basename='feed.json')
        return Feed(snapshot_uri)

def _subfeed_hash(subfeed_name):
    if isinstance(subfeed_name, str):
        return _sha1_of_string(subfeed_name)
    else:
        return _sha1_of_object(subfeed_name)

def _sha1_of_string(txt: str) -> str:
    hh = hashlib.sha1(txt.encode('utf-8'))
    ret = hh.hexdigest()
    return ret

def _sha1_of_object(obj: object) -> str:
    txt = json.dumps(obj, sort_keys=True, separators=(',', ':'))
    return _sha1_of_string(txt)


class Subfeed:
    def __init__(self, *, feed, subfeed_name, position):
        self._feed = feed
        self._feed_uri = feed._feed_uri
        self._feed_id = feed._feed_id
        self._is_writeable = feed._is_writeable
        self._subfeed_name = subfeed_name
        self._position = position
        self._subfeed_hash = _subfeed_hash(self._subfeed_name)

        if isinstance(self._subfeed_name, str):
            self._subfeed_name_str = self._subfeed_name
        else:
            self._subfeed_name_str = '~' + self._subfeed_hash

        self._initialize()

    def _initialize(self):
        pass

    def get_uri(self):
        feed_uri = self._feed_uri
        if feed_uri.startswith('feed://'):
            return f'{self._feed_uri}/{quote(self._subfeed_name_str)}'
        elif feed_uri.startswith('sha1://'):
            return f'{self._feed_uri}?subfeedName={quote(self._subfeed_name_str)}'
        else:
            raise Exception(f'Unexpected feed uri: {feed_uri}')

    def get_position(self):
        return self._position
    
    def get_subfeed_name(self):
        return self._subfeed_name
    
    def get_subfeed_hash(self):
        return self._subfeed_hash

    def set_position(self, position):
        self._position = position

    def get_num_messages(self):
        if not self.is_snapshot():
            port = _api_port()
            url = f'http://localhost:{port}/feed/getNumMessages'
            x = _http_post_json(url, dict(
                feedId=self._feed_id,
                subfeedHash=self._subfeed_hash
            ))
            assert x['success'], f'Unable to get num. messages for subfeed: {self._feed_id} {self._subfeed_name_str}'
            return x['numMessages']
        else:
            messages = self._get_snapshot_messages()
            return len(messages)
        
    def _get_snapshot_messages(self):
        # only applies when feed is a snapshot
        try:
            obj = self._feed._snapshot_object['subfeeds'][self._subfeed_hash]
            return obj['messages']
        except:
            return []

    def get_next_messages(self, *, wait_msec=10, signed=False, max_num_messages=0, advance_position=True):
        if not self.is_snapshot():
            port = _api_port()
            if signed:
                url = f'http://localhost:{port}/feed/getSignedMessages'
            else:
                url = f'http://localhost:{port}/feed/getMessages'
            x = _http_post_json(url, dict(
                feedId=self._feed_id,
                subfeedHash=self._subfeed_hash,
                position=self._position,
                maxNumMessages=max_num_messages,
                waitMsec=wait_msec
            ))
            if not x['success']:
                raise Exception(f'Error getting next messages: {x.get("error")}')
            messages = []
            if signed:
                for msg in x['signedMessages']:
                    messages.append(msg)
            else:
                for msg in x['messages']:
                    messages.append(msg)
            if advance_position:
                self._position = self._position + len(messages)
            return messages
        else:
            messages = self._get_snapshot_messages()
            position = self._position
            if max_num_messages > 0:
                ret = messages[position:position + max_num_messages]
            else:
                ret = messages[position:]
            if advance_position:
                self._position = self._position + len(ret)
            return ret

    def get_next_message(self, *, wait_msec, signed=False, advance_position=True):
        messages = self.get_next_messages(wait_msec=wait_msec, signed=signed, max_num_messages=1, advance_position=advance_position)
        if messages is None:
            return None
        if len(messages) == 0:
            return None
        return messages[0]
    
    def message_stream(self, *, signed=False):
        class custom_iterator:
            def __init__(self, parent):
                self._parent = parent
                self._messages = []
                self._relative_position = 0
                self._load_messages()
            
            def _load_messages(self):
                messages = self._parent.get_next_messages(wait_msec=5000, signed=signed, advance_position=False)
                if messages is None:
                    return
                for msg in messages:
                    self._messages.append(msg)

            def __iter__(self):
                return self

            def __next__(self):
                while self._relative_position >= len(self._messages):
                    self._load_messages()
                    if self._relative_position >= len(self._messages):
                        if self._parent.is_snapshot():
                            raise StopIteration
                        time.sleep(0.05)
                self._parent._position = self._parent._position + 1
                self._relative_position = self._relative_position + 1
                return self._messages[self._relative_position - 1]
        return custom_iterator(parent=self)
    
    def is_snapshot(self):
        return self._feed.is_snapshot()
    
    def is_writeable(self):
        return self._feed.is_writeable()

    def print_messages(self):
        for msg in self.message_stream():
            print(msg)
    
    def print_signed_messages(self):
        for msg in self.message_stream(signed=True):
            print(msg)

    def append_message(self, message):
        self.append_messages([message])

    def append_messages(self, messages):
        if not self.is_writeable():
            raise Exception('Cannot append messages to a readonly feed')
        port = _api_port()
        url = f'http://localhost:{port}/feed/appendMessages'
        x = _http_post_json(url, dict(
            feedId=self._feed_id,
            subfeedHash=self._subfeed_hash,
            messages=messages
        ))
        if not x['success']:
            raise Exception('Unable to append messages.')
    
    def submit_message(self, message):
        self.submit_messages([message])

    def submit_messages(self, messages):
        if self.is_snapshot():
            raise Exception('Cannot submit messages to a snapshot')
        port = _api_port()
        for message in messages:
            url = f'http://localhost:{port}/feed/submitMessage'
            x = _http_post_json(url, dict(
                feedId=self._feed_id,
                subfeedHash=self._subfeed_hash,
                message=message,
                timeoutMsec=4000
            ))
            if not x['success']:
                raise Exception(f'Unable to submit message: {x.get("error")}')

    def set_access_rules(self, access_rules):
        if not self._is_writeable:
            raise Exception('Cannot set access rules for non-writeable feed')
        port = _api_port()
        url = f'http://localhost:{port}/feed/setAccessRules'
        x = _http_post_json(url, dict(
            feedId=self._feed_id,
            subfeedHash=self._subfeed_hash,
            accessRules=access_rules
        ))
        if not x['success']:
            raise Exception('Unable to set access rules.')
    
    def get_access_rules(self):
        if not self._is_writeable:
            raise Exception('Cannot get access rules for non-writeable feed')
        port = _api_port()
        url = f'http://localhost:{port}/feed/getAccessRules'
        x = _http_post_json(url, dict(
            feedId=self._feed_id,
            subfeedHash=self._subfeed_hash
        ))
        if not x['success']:
            raise Exception('Unable to get access rules.')
        print(x)
        return x['accessRules']
    
    def grant_write_access(self, *, node_id):
        access_rules = self.get_access_rules()
        changed = False
        found = False
        for r in access_rules['rules']:
            if r.get('nodeId', None) == node_id:
                if r.get('write', None) is not True:
                    changed = True
                    r['write'] = True
                found = True
        if not found:
            access_rules['rules'].append(dict(
                nodeId=node_id,
                write=True
            ))
            changed = True
        if changed:
            self.set_access_rules(access_rules)
    
    def revoke_write_access(self, *, node_id):
        access_rules = self.get_access_rules()
        changed = False
        for r in access_rules['rules']:
            if r.get('nodeId', None) == node_id:
                if r.get('write', None) is True:
                    changed = True
                    r['write'] = False
        if changed:
            self.set_access_rules(access_rules)

def _create_feed(feed_name=None):
    port = _api_port()
    url = f'http://localhost:{port}/feed/createFeed'
    req_data = dict()
    if feed_name is not None:
        req_data['feedName'] = feed_name
    x = _http_post_json(url, req_data)
    if not x['success']:
        raise Exception(f'Unable to create feed: {feed_name}')
    return _load_feed('feed://' + x['feedId'])

def _delete_feed(feed_name_or_uri):
    if feed_name_or_uri.startswith('feed://'):
        feed_uri = feed_name_or_uri
        feed_id, subfeed_name, position = _parse_feed_uri(feed_uri)
        assert subfeed_name is None, 'Cannot specify subfeed name when deleting feed'
        port = _api_port()
        url = f'http://localhost:{port}/feed/deleteFeed'
        x = _http_post_json(url, dict(
            feedId=feed_id
        ))
        if not x['success']:
            raise Exception(f'Unable to delete feed {feed_id}: {x.get("error", None)}')
    else:
        feed_name = feed_name_or_uri
        feed_id = _get_feed_id(feed_name, create=False)
        assert feed_id is not None, f'Unable to find feed with name: {feed_name}'
        _delete_feed(f'feed://{feed_id}')

def _get_feed_id(feed_name, *, create=False):
    port = _api_port()
    url = f'http://localhost:{port}/feed/getFeedId'
    x = _http_post_json(url, dict(
        feedName=feed_name
    ))
    if not x['success']:
        if create:
            return _create_feed(feed_name)._feed_id
        else:
            raise Exception(f'Unable to load feed with name: {feed_name}')
    feed_id = x['feedId']
    return feed_id

def _load_subfeed(subfeed_uri):
    feed_id, subfeed_name, position = _parse_feed_uri(subfeed_uri)
    assert subfeed_name is not None, 'No subfeed name found'
    return Feed('feed://' + feed_id).get_subfeed(subfeed_name=subfeed_name, position=position)
        
def _load_feed(feed_name_or_uri, *, timeout_sec: Union[None, float]=None, create=False):
    if feed_name_or_uri.startswith('feed://'):
        if create is True:
            raise Exception('Cannot use create=True when feed ID is specified.')
        feed_uri = feed_name_or_uri
        feed_id, subfeed_name, position = _parse_feed_uri(feed_uri)
        assert subfeed_name is None, 'Not a feed uri'
        return Feed('feed://' + feed_id, timeout_sec=timeout_sec)
    elif feed_name_or_uri.startswith('sha1://'):
        if create is True:
            raise Exception('Cannot use create=True when feed is a snapshot.')
        feed_uri = feed_name_or_uri
        return Feed(feed_uri)
    else:
        feed_name = feed_name_or_uri
        feed_id = _get_feed_id(feed_name, create=create)
        return _load_feed(f'feed://{feed_id}')

def _watch_for_new_messages(subfeed_watches, *, wait_msec):
    port = _api_port()
    url = f'http://localhost:{port}/feed/watchForNewMessages'
    subfeed_watches2 = {}
    for key, watch in subfeed_watches.items():
        subfeed_watches2[key] = {
            'feedId': watch['feedId'],
            'subfeedHash': _subfeed_hash(watch['subfeedName']),
            'position': watch['position']
        }
    x = _http_post_json(url, dict(
        subfeedWatches=subfeed_watches2,
        waitMsec=wait_msec
    ))
    if not x['success']:
        raise Exception(f'Unable to watch for new messages.')
    return x['messages']

def _parse_feed_uri(uri):
    listA = uri.split('?')
    assert len(listA) >= 1
    list0 = listA[0].split('/')
    assert len(list0) >= 3
    protocol = list0[0].replace(':', '')
    assert protocol == 'feed'
    feed_id = list0[2]
    if len(list0) >= 3:
        subfeed_name = '/'.join(list0[3:])
    else:
        subfeed_name = None
    if subfeed_name:
        subfeed_name = unquote(subfeed_name)
    else:
        subfeed_name = None
    return feed_id, subfeed_name, 0
