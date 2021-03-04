#!/bin/bash

DIRECTORY=$(cd `dirname $0` && pwd)
source $DIRECTORY/env_daemon1.sh
mkdir -p $KACHERY_STORAGE_DIR

export KACHERY_P2P_API_PORT=20441

# kachery-p2p-start-daemon --method dev --udp-port 14508 "$@"
kachery-p2p-start-daemon --method dev --noudp "$@"
