#!/bin/bash

DIRECTORY=$(cd `dirname $0` && pwd)
export KACHERY_STORAGE_DIR=$DIRECTORY/kachery-storage
export KACHERY_P2P_CONFIG_DIR=$KACHERY_STORAGE_DIR
mkdir -p $KACHERY_STORAGE_DIR

$DIRECTORY/../daemon/bin/kachery-p2p-daemon start --channel test1 "$@"
