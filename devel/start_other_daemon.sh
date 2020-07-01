#!/bin/bash

DIRECTORY=$(cd `dirname $0` && pwd)
export KACHERY_P2P_API_PORT=20441
export KACHERY_STORAGE_DIR=$DIRECTORY/kachery-storage-other
export KACHERY_P2P_CONFIG_DIR=$KACHERY_STORAGE_DIR
mkdir -p $KACHERY_STORAGE_DIR

$DIRECTORY/../daemon/bin/kachery-p2p-daemon start --channel test1 "$@"
