import setuptools

setuptools.setup(
    packages=setuptools.find_packages(),
    include_package_data=True,
    scripts=[
        "bin/kachery-p2p",
        "bin/kachery-p2p-cat",
        "bin/kachery-p2p-find",
        "bin/kachery-p2p-get-channels",
        "bin/kachery-p2p-join-channel",
        "bin/kachery-p2p-leave-channel",
        "bin/kachery-p2p-load",
        "bin/kachery-p2p-store",
        "bin/kachery-p2p-print-messages",
        "bin/kachery-p2p-start-daemon",
        "bin/kachery-p2p-stop-daemon",
        "bin/kachery-p2p-node-info"
    ],
    install_requires=[
        "click",
        "simplejson",
        "requests",
        "jinjaroot"
    ]
)
