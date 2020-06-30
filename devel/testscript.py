import kachery_p2p as kp

# swarm_names = kp.daemon.get_swarm_names()
# print(swarm_names)

# x = kp.load_file('sha1://7da2a66f0091de95d03b9faec833c56de3f45b66/.gitignore', _debug=True)
# print(x)

x = kp.find_file('sha1://7da2a66f0091de95d03b9faec833c56de3f45b66/.gitignore')
while True:
    r = x.get_next()
    if r is None:
        break
    print(r)