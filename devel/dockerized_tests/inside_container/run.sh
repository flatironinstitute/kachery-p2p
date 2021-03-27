#!/bin/bash

set -ex

cd /inside_container

KACHERY_P2P_API_PORT=10101 kachery-p2p-start-daemon --label test1 &

KACHERY_P2P_API_PORT=10101 ./scripts/wait_for_daemon_to_start.py

KACHERY_P2P_API_PORT=10101 kachery-p2p-node-info

sleep 3