#!/bin/bash

DIRECTORY=$(cd `dirname $0` && pwd)
source $DIRECTORY/env_bootstrap.sh
mkdir -p $KACHERY_STORAGE_DIR

kachery-p2p-start-daemon --method dev --host localhost --port 3008 --isbootstrap --nobootstrap --websocket-port 4017 "$@"
