# Instructions for beta testers

Thank you for helping to test the kachery-p2p software!

## Installation

Please install kachery-p2p by following the Conda installation instructions found [here](../doc/setup_and_installation.md) (or the non-Conda instructions if you prefer).

Open a terminal and verify that you have the following commands available:

```
kachery-store
kachery-p2p-load
kachery-p2p-start-daemon
kachery-p2p-join-channel
kachery-p2p-leave-channel
kachery-p2p-find
kachery-p2p-load
kachery-p2p-cat
```

Check the version by running:

```
kachery-p2p version
```

The current version should be `0.6.3` and the current protocol version should be `0.6.1p`.

## Start a daemon

By running a daemon on your computer you are creating a node on the kachery-p2p network.

In a new terminal (activate the conda environment), start the daemon.

```
kachery-p2p-start-daemon --label <node-label>
```

where `<node-label>` is a display name you choose for your new node. This name will be visible to others.

Keep this program running in a terminal (you may want to use [tmux](https://github.com/tmux/tmux/wiki) or screen).

Join the test channel by running the following in a separate terminal:

```
kachery-p2p-join-channel https://gist.githubusercontent.com/magland/542b2ef7c268eb99d87d7b965567ece0/raw/ccm-test-channel.yaml
```

While this daemon is running, other members of this example channel have access to any file that you store in your local kachery database (provided they know the SHA-1 hash).

If you are able to do so, please keep this daemon open even after you have run the tests, so that testing may continue by others with your node on the system. Note that if files are downloaded by others from your computer, you will experience outgoing network traffic on your computer.

## Downloading files

In a new terminal (activate the conda environment), run:

```
kachery-p2p-load sha1://c37d2a4b156ff9bcfdbbd2eec12b9c6b74135685/test1.txt
```

This will download a small text file from the kachery-p2p network and will display the path where the file is stored inside the $KACHERY_STORAGE_DIR. Verify that the content of the file starts with `"This is an example text file..."`

```
cat `kachery-p2p-load sha1://c37d2a4b156ff9bcfdbbd2eec12b9c6b74135685/test1.txt`
```

Also verify that this gives you the same output:

```
kachery-p2p-cat sha1://c37d2a4b156ff9bcfdbbd2eec12b9c6b74135685/test1.txt
```

Now do something similar in Python (for example use `ipython` which can be installed via `pip install ipython`):

```python
import kachery_p2p as kp
a = kp.load_text('sha1://c37d2a4b156ff9bcfdbbd2eec12b9c6b74135685/test1.txt')
print(a)
```

Next, download a larger 4MB file (numpy array):

```python
import kachery_p2p as kp
a = kp.load_npy('sha1://0db97719836f0c3f3fdd2f8870530dcd7158b985/file_4MB.npy')
print(a.shape)
```

The shape of this array should be `(500, 500, 2)`.

Verify that if you run this script again, the file does not need to be re-downloaded (the file will be loaded much more quickly).

Now we'll go for something larger (600 MB):

```python
import kachery_p2p as kp

# Note: if you interrupt this download (via ctrl+c),
# then when you restart, it should pick up roughly
# where you left off
a = kp.load_npy('sha1://e626c1d97cb80d4c1d5ed76c7fbc86f395b181d5/file.npy?manifest=848d2fead4b95681bc3c7aa52955af192cc9c1c7')

# here's a periodic file where only the first 3 chunks actually need to be downloaded
# a = kp.load_npy('sha1://2732ce0fe8e3cb74d8b39c2fe982a14afecc58a1/file.npy?manifest=357870edbcfdc7767578a0fb5ae26d66b324d052')

print(a.shape)
```

This should take around 1-2 minutes (depending on the speed of your internet connection). The shape of the downloaded array should be `(500, 500, 300)`. While you wait, you could move on to the next tests in a new terminal. Or you could test the auto-resume capability by stopping and starting the download (see the note above).

## Sharing files

Sharing a snapshot of a file on the kachery-p2p network is as simple as storing the file in your local kachery database (located at `$KACHERY_STORAGE_DIR`).

Create a test text file with some unique content

```bash
# But make your content unique
echo -e "My unique content\nwith multiple lines\n" > tmp.txt
```

Then store a copy locally:

```bash
kachery-store tmp.txt
```

Copy the URI that is printed it will have the form `sha1://.../tmp.txt`

Now anyone with that URI (on the example channel) will be able to download that file directly from your computer (or from another computer if it was downloaded elsewhere).

To test that this worked, you will need to install kachery-p2p on a different computer, and email/slack yourself the URI. From the other computer (with a running daemon on the example channel) try:

```bash
kachery-p2p-cat sha1://.../tmp.txt
```

Or, if you only have one computer, you could also email your link to the authors and we can verify that it worked.

You can also store snapshots of items directly from Python.

```python
import kachery_p2p as kp
import kachery as ka
import numpy as np

uri_txt = ka.store_text('Some test text')
print(uri_txt)

uri_dict = ka.store_object(dict(name='test-dict'))
print(uri_dict)

A = np.random.normal(0, 1, (500, 500, 5));
uri_npy = kp.store_npy(A)
print(uri_npy)
```

Try to load those files from another computer (on the example channel), or send the URIs to the authors.

## Reading feeds

It is also possible to share live feeds (collections of append-only logs) that can update in real time. Here's an example feed on the example channel that you can read. Do this in Python:

```python
import kachery_p2p as kp

sf = kp.load_subfeed('feed://d8a6fe9049f699e5e60bf0937394a986a974d4529c94baa37a6327be72b43148/test-subfeed')
messages = sf.get_next_messages()
for message in messages:
    print('MESSAGE:', message)
```

You should see at least a couple of messages.

## Writing feeds

Here's how you can create your own feed (in Python):

```python
import kachery_p2p as kp

f = kp.create_feed('example-feed')
sf = f.get_subfeed('default')
sf.append_message({'name': 'some-test-message', 'data': [4, 9, 1]})
uri = sf.get_uri()
print(uri)

# You can read from this subfeed from any computer using this uri
# Or, on this computer, you can retrieve the feed using `f = kp.load_feed('example-feed')` above
# Note that this second method of retrieving by name only works on the node where the feed was created
```

Now from the terminal you can view the messages

```bash
kachery-p2p-print-messages feed://your-subfeed-uri...
```

Keep that terminal open and append more messages (in real time):

```python
import kachery_p2p as kp

sf = kp.load_subfeed('feed://your-subfeed-uri...')
sf.append_message({'name': 'another-test-message'})
```

If you run that command, you should see the messages appear in real time in the terminal you left open.

Now try running the `kachery-p2p-print-messages` command on a different computer (that has a running daemon on the example channel). You should be able to see the live-updating messages from there.
