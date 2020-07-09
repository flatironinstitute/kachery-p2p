from os import wait
import time
from .core import _api_port
from .core import _http_post_json
from urllib.parse import quote, unquote

class Feed:
    def __init__(self, *, feed_id):
        self._feed_id = feed_id
        self._feed_info = None
        self._is_writeable = None
        self._initialize()
    def _initialize(self):
        port = _api_port()
        url = f'http://localhost:{port}/feed/getFeedInfo'
        x = _http_post_json(url, dict(
            feedId=self._feed_id
        ))

        assert x['success'], f'Unable to initialize feed: {self._feed_id}. {x["error"]}'
        self._feed_info = x['info']
        self._is_writeable = x['info']['isWriteable']
    def is_writeable(self):
        return self._is_writeable
    def get_uri(self):
        return f'feed://{self._feed_id}'
    def get_subfeed(self, subfeed_name, position=0):
        return Subfeed(feed=self, subfeed_name=subfeed_name, position=position)

class Subfeed:
    def __init__(self, *, feed, subfeed_name, position):
        self._feed = feed
        self._feed_id = feed._feed_id
        self._is_writeable = feed._is_writeable
        self._subfeed_name = subfeed_name
        self._position = position
        self._initialize()
    def _initialize(self):
        pass
    def get_uri(self):
        return f'feed://{self._feed_id}/{quote(self._subfeed_name)}'
    def get_position(self):
        return self._position
    def set_position(self, position):
        self._position = position
    def get_num_messages(self):
        port = _api_port()
        url = f'http://localhost:{port}/feed/getNumMessages'
        x = _http_post_json(url, dict(
            feedId=self._feed_id,
            subfeedName=self._subfeed_name,
        ))
        assert x['success'], f'Unable to get num. messages for feed: {self._feed_id}'
        return x['numMessages']
    
    def get_next_messages(self, *, wait_msec, signed=False, max_num_messages=10, advance_position=True):
        port = _api_port()
        if signed:
            url = f'http://localhost:{port}/feed/getSignedMessages'
        else:
            url = f'http://localhost:{port}/feed/getMessages'
        x = _http_post_json(url, dict(
            feedId=self._feed_id,
            subfeedName=self._subfeed_name,
            position=self._position,
            maxNumMessages=max_num_messages,
            waitMsec=wait_msec
        ))
        if not x['success']:
            return None
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
                        time.sleep(0.05)
                self._parent._position = self._parent._position + 1
                self._relative_position = self._relative_position + 1
                return self._messages[self._relative_position - 1]
        return custom_iterator(parent=self)

    def print_messages(self):
        for msg in self.message_stream():
            print(msg)
    
    def print_signed_messages(self):
        for msg in self.message_stream(signed=True):
            print(msg)

    def append_message(self, message):
        self.append_messages([message])

    def append_messages(self, messages):
        port = _api_port()
        url = f'http://localhost:{port}/feed/appendMessages'
        x = _http_post_json(url, dict(
            feedId=self._feed_id,
            subfeedName=self._subfeed_name,
            messages=messages
        ))
        if not x['success']:
            raise Exception('Unable to append messages.')
    
    def submit_message(self, message):
        self.submit_messages([message])

    def submit_messages(self, messages):
        port = _api_port()
        url = f'http://localhost:{port}/feed/submitMessages'
        x = _http_post_json(url, dict(
            feedId=self._feed_id,
            subfeedName=self._subfeed_name,
            messages=messages
        ))
        if not x['success']:
            raise Exception('Unable to submit messages.')

    def set_access_rules(self, rules):
        if not self._is_writeable:
            raise Exception('Cannot set access rules for non-writeable feed')
        port = _api_port()
        url = f'http://localhost:{port}/feed/setAccessRules'
        x = _http_post_json(url, dict(
            feedId=self._feed_id,
            subfeedName=self._subfeed_name,
            rules=rules
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
            subfeedName=self._subfeed_name
        ))
        if not x['success']:
            raise Exception('Unable to get access rules.')
        print(x)
        return x['rules']
    
    def grant_write_access(self, *, node_id):
        rules = self.get_access_rules()
        changed = False
        found = False
        for r in rules['rules']:
            if r.get('nodeId', None) == node_id:
                if r.get('write', None) is not True:
                    changed = True
                    r['write'] = True
                found = True
        if not found:
            rules['rules'].append(dict(
                nodeId=node_id,
                write=True
            ))
            changed = True
        if changed:
            self.set_access_rules(rules)
    
    def revoke_write_access(self, *, node_id):
        rules = self.get_access_rules()
        changed = False
        for r in rules['rules']:
            if r.get('nodeId', None) == node_id:
                if r.get('write', None) is True:
                    changed = True
                    r['write'] = False
        if changed:
            self.set_access_rules(rules)

def create_feed(feed_name=None):
    port = _api_port()
    url = f'http://localhost:{port}/feed/createFeed'
    x = _http_post_json(url, dict(
        feedName=feed_name
    ))
    if not x['success']:
        raise Exception(f'Unable to create feed: {feed_name}')
    return load_feed('feed://' + x['feedId'])

def load_feed(feed_name_or_uri, *, create=False):
    if feed_name_or_uri.startswith('feed://'):
        if create is True:
            raise Exception('Cannot use create=True when feed ID is specified.')
        feed_uri = feed_name_or_uri
        feed_id, subfeed_name, position = _parse_feed_uri(feed_uri)
        if subfeed_name is None:
            return Feed(feed_id=feed_id)
        else:
            return Feed(feed_id=feed_id).get_subfeed(subfeed_name=subfeed_name, position=position)
    else:
        feed_name = feed_name_or_uri
        port = _api_port()
        url = f'http://localhost:{port}/feed/getFeedId'
        x = _http_post_json(url, dict(
            feedName=feed_name
        ))
        if not x['success']:
            if create:
                return create_feed(feed_name)
            else:
                raise Exception('Unable to load feed.')
        feed_id = x['feedId']
        return load_feed(f'feed://{feed_id}')

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