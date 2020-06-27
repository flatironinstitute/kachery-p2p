#!/bin/bash

DIRECTORY=$(cd `dirname $0` && pwd)
export KACHERY_STORAGE_DIR=$DIRECTORY/kachery-storage
mkdir -p $KACHERY_STORAGE_DIR

$DIRECTORY/../daemon/bin/kachery-p2p-daemon start --swarm test5 "$@"
