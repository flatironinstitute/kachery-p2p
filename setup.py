import codecs
import os.path
import setuptools

def read(rel_path):
    here = os.path.abspath(os.path.dirname(__file__))
    with codecs.open(os.path.join(here, rel_path), 'r') as fp:
        return fp.read()

def get_version(rel_path):
    for line in read(rel_path).splitlines():
        if line.startswith('__version__'):
            delim = '"' if '"' in line else "'"
            return line.split(delim)[1]
    else:
        raise RuntimeError("Unable to find version string.")


pkg_name = "kachery_p2p"

setuptools.setup(
    name=pkg_name,
    version=get_version("kachery_p2p/__init__.py"),
    author="Jeremy Magland",
    author_email="jmagland@flatironinstitute.org",
    description="Run batches of Python functions in containers and on remote servers",
    url="https://github.com/magland/kachery_p2p",
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
        "bin/kachery-p2p-start-daemon"
    ],
    install_requires=[
        "kachery>=0.6.3"
    ],
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: Apache Software License",
        "Operating System :: OS Independent",
    ]
)
