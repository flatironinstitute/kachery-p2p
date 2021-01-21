import time

import pytest
from kachery_p2p import TestDaemon
from kachery_p2p._preventkeyboardinterrupt import PreventKeyboardInterrupt


def run_test(test_nodes, tmpdir):
    api_port = 30001
    try:
        # Start the daemons
        for tn in test_nodes:
            d = TestDaemon(
                label='d',
                channels=tn['channels'],
                api_port=api_port,
                storage_dir=tmpdir + f'/test_storage_{api_port}_{_randstr(5)}',
                port=tn['port'],
                websocket_port=tn['websocket_port'],
                bootstraps=tn['bootstraps'],
                isbootstrap=tn['isbootstrap'],
                nomulticast=True
            )
            tn['daemon'] = d
            tn['api_port'] = api_port
            print(f'starting daemon: {tn["name"]}')
            d.start()
            api_port = api_port + 1
            
        # pause
        time.sleep(0.5)

        # Store some objects
        for tn in test_nodes:
            d = tn['daemon']
            tn['uris'] = []
            with d.testEnv():
                import kachery as ka
                for obj in tn['objects_to_store']:
                    uri = ka.store_object(obj)
                    tn['uris'].append(uri)

        
        # Pause
        time.sleep(10)

        # Load the objects
        for tn in test_nodes:
            d = tn['daemon']
            with d.testEnv():
                import kachery as ka
                import kachery_p2p as kp
                for tn2 in test_nodes:
                    if tn['name'] != tn2['name']:
                        for uri in tn2['uris']:
                            print(f'Node {tn["name"]} is loading {uri} from node {tn2["name"]}')
                            obj = kp.load_object(uri)
                            assert(obj is not None)
    finally:
        with PreventKeyboardInterrupt():
            for tn in test_nodes:
                d = tn['daemon']
                print(f'stopping daemon: {tn["name"]}')
                try:
                    d.stop()
                except:
                    print('WARNING: Failed to stop daemon.')

def test_1(tmpdir):    
    import kachery as ka
    N = 2
    objects = [
        dict(a=a, x=[j for j in range(1000000)])
        for a in range(0, N)
    ]
    test_nodes = []
    for a in range(0, N):
        tn = dict(
            name=f'Node {a}',
            channels = ['testA'],
            objects_to_store = [objects[a]],
            port = 42000 + a,
            websocket_port = 45000 if a == 0 else None,
            bootstraps=["localhost:42000"] if a > 0 else None,
            isbootstrap=True if a == 0 else False
        )
        test_nodes.append(tn)
    run_test(test_nodes=test_nodes, tmpdir=str(tmpdir))

# def test_2(tmpdir):    
#     import kachery as ka
#     import kachery_p2p as kp
#     N = 3
#     objects = [
#         dict(a=a, x=[j for j in range(1000000)])
#         for a in range(0, N)
#     ]
#     test_nodes = []
#     for a in range(0, N):
#         tn = dict(
#             name=f'Node {a}',
#             channels = [f'testA-{a}'],
#             objects_to_store = [objects[a]],
#             port = 42000 + a,
#             bootstraps=["localhost:42000"] if a > 0 else None,
#             isbootstrap=True if a == 0 else False
#         )
#         test_nodes.append(tn)
#     with pytest.raises(kp.LoadFileError):
#         run_test(test_nodes=test_nodes, tmpdir=str(tmpdir))

def _randstr(n):
    import random
    import string
    return ''.join(random.choice(string.ascii_lowercase) for _ in range(n))
