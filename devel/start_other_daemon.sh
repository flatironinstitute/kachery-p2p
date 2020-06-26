#!/bin/bash

DIRECTORY=$(cd `dirname $0` && pwd)
export API_PORT=20441
export KACHERY_STORAGE_DIR=$DIRECTORY/kachery-storage-other
mkdir -p $KACHERY_STORAGE_DIR

$DIRECTORY/../daemon/bin/kachery-p2p-daemon start --swarm test1