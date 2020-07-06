from .core import _api_port
from .core import _http_post_json

class _Feed:
    def __init__(self, *, feed_id, subfeed_name, position):
        self._feed_id = feed_id
        self._subfeed_name = subfeed_name
        self._position = position
        self._info = None
        self._initialize()
    def get_path(self):
        return f'feed://{self._feed_id}/{self._subfeed_name}'
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
        if not x['success']:
            return None
        return x['numMessages']
    def get_messages(self, *, max_num_messages=None, wait_msec=None):
        position = self._position
        port = _api_port()
        url = f'http://localhost:{port}/feed/getMessages'
        x = _http_post_json(url, dict(
            feedId=self._feed_id,
            subfeedName=self._subfeed_name,
            position=position,
            maxNumMessages=max_num_messages,
            waitMsec=wait_msec
        ))
        if not x['success']:
            return None
        messages = x['messages']
        self._position = position + len(messages)
        return messages
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
    def get_subfeed(self, subfeed_name):
        if self._subfeed_name is not None:
            raise Exception('Cannot load subfeed of a subfeed.')
        return _Feed(feed_id=self._feed_id, subfeed_name=subfeed_name, position=0)
    def _initialize(self):
        port = _api_port()
        url = f'http://localhost:{port}/feed/getInfo'
        x = _http_post_json(url, dict(
            feedId=self._feed_id,
            subfeedName=self._subfeed_name
        ))
        if not x['success']:
            raise Exception('Unable to initialize feed.')
        self._info = x['info']

def create_feed(feed_name):
    port = _api_port()
    url = f'http://localhost:{port}/feed/createFeed'
    x = _http_post_json(url, dict(
        feedName=feed_name
    ))
    if not x['success']:
        raise Exception(f'Unable to create feed: {feed_name}')
    return load_feed(feed_name)

def load_feed(feed_name_or_path, create=False):
    if feed_name_or_path.startswith('feed://'):
        if create is True:
            raise Exception('Cannot use create=True when feed ID is specified.')
        feed_path = feed_name_or_path
        feed_id, subfeed_name, position = _parse_feed_path(feed_path)
        return _Feed(feed_id=feed_id, subfeed_name=subfeed_name, position=position)
    else:
        feed_name = feed_name_or_path
        port = _api_port()
        url = f'http://localhost:{port}/feed/getFeedId'
        x = _http_post_json(url, dict(
            feedName=feed_name
        ))
        if not x['success']:
            return create_feed(feed_name)
        feed_id = x['feedId']
        return load_feed(f'feed://{feed_id}')

def _parse_feed_path(path):
    listA = path.split('?')
    assert len(listA) >= 1
    list0 = listA[0].split('/')
    assert len(list0) >= 3
    protocol = list0[0].replace(':', '')
    assert protocol == 'feed'
    feed_id = list0[2]
    if len(list0) >= 3:
        subfeed_name = '/'.join(list0[3:])
    else:
        subfeed_name = 'default'
    return feed_id, subfeed_name, 0