import time
from kachery_p2p._preventkeyboardinterrupt import PreventKeyboardInterrupt
from kachery_p2p import TestDaemon
import pytest

def run_test(test_nodes, tmpdir):
    api_port = 30001
    try:
        # Start the daemons
        for tn in test_nodes:
            d = TestDaemon(
                channels=tn['channels'],
                api_port=api_port,
                storage_dir=tmpdir + f'/test_storage_{api_port}_{_randstr(5)}',
                port=tn['port'],
                bootstraps=tn['bootstraps']
            )
            tn['daemon'] = d
            tn['api_port'] = api_port
            print(f'starting daemon: {tn["name"]}')
            d.start()
            api_port = api_port + 1
            
        # pause
        time.sleep(3)

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
        time.sleep(3)

        # Load the objects
        for tn in test_nodes:
            d = tn['daemon']
            with d.testEnv():
                import kachery_p2p as kp
                import kachery as ka
                for tn2 in test_nodes:
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
    N = 3
    objects = [
        dict(a=a, x=[j for j in range(1000000)])
        for a in range(0, N)
    ]
    test_nodes = []
    for a in range(0, N):
        tn = dict(
            name=[f'Node {a}'],
            channels = ['testA'],
            objects_to_store = [objects[a]],
            port = 42000 + a,
            bootstraps=["localhost:42000"]
        )
        test_nodes.append(tn)
    run_test(test_nodes=test_nodes, tmpdir=str(tmpdir))

def test_2(tmpdir):    
    import kachery as ka
    import kachery_p2p as kp
    N = 3
    objects = [
        dict(a=a, x=[j for j in range(1000000)])
        for a in range(0, N)
    ]
    test_nodes = []
    for a in range(0, N):
        tn = dict(
            name=[f'Node {a}'],
            channels = [f'testA-{a}'],
            objects_to_store = [objects[a]],
            port = 42000 + a,
            bootstraps=["localhost:42000"]
        )
        test_nodes.append(tn)
    with pytest.raises(kp.LoadFileError):
        run_test(test_nodes=test_nodes, tmpdir=str(tmpdir))

def _randstr(n):
    import random
    import string
    return ''.join(random.choice(string.ascii_lowercase) for _ in range(n))