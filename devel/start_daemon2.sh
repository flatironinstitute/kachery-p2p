#!/bin/bash

DIRECTORY=$(cd `dirname $0` && pwd)
source $DIRECTORY/env_daemon2.sh
mkdir -p $KACHERY_STORAGE_DIR

kachery-p2p-start-daemon --channel test1 --method dev --host localhost --http-port 3010 --bootstrap localhost:3008 "$@"
