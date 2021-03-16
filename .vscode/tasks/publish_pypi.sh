#!/bin/bash

set -ex

rm -rf kachery_p2p/*.tgz
rm -rf daemon/*.tgz
.vscode/tasks/build_daemon.sh
rm -rf dist
python setup.py sdist
twine upload dist/*