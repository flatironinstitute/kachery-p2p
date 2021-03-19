#!/bin/bash

set -ex

.vscode/tasks/build_daemon.sh
rm -rf dist
python setup.py sdist
twine upload dist/*