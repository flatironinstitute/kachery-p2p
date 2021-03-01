import json
import os
import sys
from typing import List, Union

import click
import kachery_p2p as kp


@click.group(help="Kachery peer-to-peer command-line client")
def cli():
    pass

@click.command(help="Show the channels that this node belongs to.")
def get_channels():
    joined_channels = kp.get_channels()
    for a in joined_channels:
        url = a['channelConfigUrl']
        optstrings = []
        if a.get('isMessageProxy', False):
            optstrings.append('(message-proxy)')
        if a.get('isDataProxy', False):
            optstrings.append('(data-proxy)')
        if a.get('isPublic', False):
            optstrings.append('(public)')
        print(f'{url} {" ".join(optstrings)}')

def _get_joined_channels_config() -> dict:
    f = kp.load_feed('_kachery_p2p_config', create=True)
    sf = f.get_subfeed('joined-channels')
    num_messages = sf.get_num_messages()
    if (num_messages > 0):
        sf.set_position(num_messages - 1)
        joined_channels_config = sf.get_next_message(wait_msec=100)
    else:
        joined_channels_config = {
            'joinedChannels': []
        }
    return joined_channels_config

def _set_joined_channels_config(joined_channels_config: dict):
    f = kp.load_feed('_kachery_p2p_config', create=True)
    sf = f.get_subfeed('joined-channels')
    sf.append_message(joined_channels_config)

@click.command(help="Join a kachery-p2p channel")
@click.argument('channel_config_url')
@click.option('--message-proxy', is_flag=True, help='Serve as a message proxy in this channel')
@click.option('--data-proxy', is_flag=True, help='Serve as a data proxy in this channel')
@click.option('--public', is_flag=True, help='Serve as a public node in this channel')
def join_channel(channel_config_url: str, message_proxy: bool, data_proxy: bool, public: bool):
    # handle this URL
    # https://gist.githubusercontent.com/magland/542b2ef7c268eb99d87d7b965567ece0/raw/0c1a9671b37ca117f7c0d4f2e6057a9a8eeb75b2/ccm-test-channel.yaml
    if channel_config_url.startswith('https://gist.githubusercontent.com/'):
        a = channel_config_url.split('/')
        if a[5] == 'raw':
            if len(a) == 8:
                print('WARNING: adjusting the URL of this gist in order to point to the latest snapshot')
                channel_config_url = '/'.join(a[:6]) + '/' + a[7]

    joined_channels_config = _get_joined_channels_config()
    joined_channels = joined_channels_config['joinedChannels']
    new_joined_channel_config = {
        'channelConfigUrl': channel_config_url,
        'isMessageProxy': message_proxy,
        'isDataProxy': data_proxy,
        'isPublic': public
    }
    new_joined_channels = []
    updated_existing = False
    for a in joined_channels:
        if a['channelConfigUrl'] == channel_config_url:
            updated_existing = True
            new_joined_channels.append(new_joined_channel_config)
        else:
            new_joined_channels.append(a)
    if not updated_existing:
        new_joined_channels.append(new_joined_channel_config)
    joined_channels_config['joinedChannels'] = new_joined_channels
    _set_joined_channels_config(joined_channels_config)
    if updated_existing:
        print('Updated existing channel configuration')
    else:
        print('Joined channel')

@click.command(help="Leave a kachery-p2p channel")
@click.argument('channel_config_url')
def leave_channel(channel_config_url):
    joined_channels_config = _get_joined_channels_config()
    joined_channels = joined_channels_config['joinedChannels']
    if channel_config_url not in [c['channelConfigUrl'] for c in joined_channels]:
        print(f'Channel not found in joined channels: {channel_config_url}')
    else:
        joined_channels_config['joinedChannels'] = [c for c in joined_channels if c['channelConfigUrl'] != channel_config_url]
        _set_joined_channels_config(joined_channels_config)
        print(f'Left channel: {channel_config_url}')

@click.command(help="Find a file.")
@click.argument('uri')
def find_file(uri):
    infos = kp.find_file(uri)
    for info in infos:
        print(json.dumps(info, indent=4))

@click.command(help="Download a file.")
@click.argument('uri')
@click.option('--dest', default=None, help='Optional local path of destination file.')
@click.option('--from-node', default=None, help='Optionally specify the ID of the node to download from')
@click.option('--from-channel', default=None, help='Optionally specify the name of the channel to download from')
@click.option('--exp-nop2p', is_flag=True, help='Disable p2p')
@click.option('--exp-file-server-url', multiple=True, help='Optional URLs of static file servers')
def load_file(uri, dest, from_node, from_channel, exp_nop2p, exp_file_server_url):
    kp._experimental_config(nop2p=exp_nop2p, file_server_urls=list(exp_file_server_url))
    x = kp.load_file(uri, dest=dest, from_node=from_node, from_channel=from_channel)
    print(x)

@click.command(help="Download a file and write the content to stdout.")
@click.argument('uri')
@click.option('--start', help='The start byte (optional)', default=None)
@click.option('--end', help='The end byte non-inclusive (optional)', default=None)
@click.option('--exp-nop2p', is_flag=True, help='Disable p2p')
@click.option('--exp-file-server-url', multiple=True, help='Optional URLs of static file servers')
def cat_file(uri, start, end, exp_nop2p, exp_file_server_url):
    old_stdout = sys.stdout
    sys.stdout = sys.stderr

    kp._experimental_config(nop2p=exp_nop2p, file_server_urls=list(exp_file_server_url))

    if start is None and end is None:
        path1 = kp.load_file(uri)
        if not path1:
            raise Exception('Error loading file for cat.')
        sys.stdout = old_stdout
        with open(path1, 'rb') as f:
            while True:
                data = os.read(f.fileno(), 4096)
                if len(data) == 0:
                    break
                os.write(sys.stdout.fileno(), data)
    else:
        assert start is not None and end is not None
        start = int(start)
        end = int(end)
        assert start <= end
        if start == end:
            return
        sys.stdout = old_stdout
        kp.load_bytes(uri=uri, start=start, end=end, write_to_stdout=True)

@click.command(help="Print messages in a subfeed.")
@click.argument('uri')
def print_messages(uri):
    sf = kp.load_subfeed(uri)
    sf.print_messages()

@click.command(help="Start the daemon.")
@click.option('--label', required=True, help='Label for this node')
@click.option('--isbootstrap', is_flag=True, help='This is a bootstrap node')
@click.option('--noudp', is_flag=True, help='Do not use a udp socket')
@click.option('--nomulticast', is_flag=True, help='Do not use multicast udp')
@click.option('--verbose', default=0, help='Verbosity level')
@click.option('--method', default='npx', help='Method for starting daemon: npx (default) or dev')
@click.option('--host', default='', help='IP for connecting to this daemon')
@click.option('--public-url', default='', help='Base URL for public http access')
@click.option('--port', default=0, help='Public http port to listen on')
@click.option('--udp-port', default=None, help='Override the udp listen port (by default equals the http port)')
@click.option('--websocket-port', default=0, help='Port for websocket server')
@click.option('--static-config', default='', help='A URL or path to a configuration file for static configuration')
@click.option('--node-arg', multiple=True, help='Additional arguments to send to node')
def start_daemon(label: str, method: str, verbose: int, host: str, public_url: str, port: int, udp_port: Union[int, None], websocket_port: int, isbootstrap: bool, noudp: bool, nomulticast: bool, static_config: str, node_arg: List[str]):
    kp.start_daemon(
        label=label,
        method=method,
        verbose=verbose,
        host=host,
        public_url=public_url,
        port=port,
        udp_port=udp_port,
        websocket_port=websocket_port,
        isbootstrap=isbootstrap,
        noudp=noudp,
        nomulticast=nomulticast,
        static_config=static_config,
        node_arg=node_arg
    )

@click.command(help="Stop the daemon.")
def stop_daemon():
    kp.stop_daemon()

@click.command(help="Print information about this node.")
def node_info():
    node_id = kp.get_node_id()
    print(f'Node ID: {node_id}')

@click.command(help="Display kachery_p2p version and exit.")
def version():
    click.echo(f"This is kachery_p2p version {kp.__version__} [protocol version {kp.__protocol_version__}].")
    exit()

cli.add_command(cat_file)
cli.add_command(find_file)
cli.add_command(get_channels)
cli.add_command(join_channel)
cli.add_command(leave_channel)
cli.add_command(load_file)
cli.add_command(node_info)
cli.add_command(print_messages)
cli.add_command(start_daemon)
cli.add_command(stop_daemon)
cli.add_command(version)