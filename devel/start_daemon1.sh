#!/bin/bash

DIRECTORY=$(cd `dirname $0` && pwd)
source $DIRECTORY/env_daemon1.sh
mkdir -p $KACHERY_STORAGE_DIR

kachery-p2p-start-daemon --channel test1 --method dev --host localhost --port 3009 --bootstrap localhost:3008 "$@"
