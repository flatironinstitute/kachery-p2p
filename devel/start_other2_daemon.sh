#!/bin/bash

DIRECTORY=$(cd `dirname $0` && pwd)
export KACHERY_P2P_API_PORT=20442
export KACHERY_STORAGE_DIR=$DIRECTORY/kachery-storage-other2
export KACHERY_P2P_CONFIG_DIR=$KACHERY_STORAGE_DIR
mkdir -p $KACHERY_STORAGE_DIR

kachery-p2p-start-daemon --channel test1 --method dev --verbose 2 --bootstrap localhost:3018 "$@"
