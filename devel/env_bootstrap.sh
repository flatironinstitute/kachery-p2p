#!/bin/bash

DIRECTORY=$(cd `dirname ${BASH_SOURCE[${#BASH_SOURCE[@]} - 1]}` && pwd)
export KACHERY_P2P_API_PORT=20450
export KACHERY_STORAGE_DIR=$DIRECTORY/kachery-storage-bootstrap
export KACHERY_P2P_CONFIG_DIR=$KACHERY_STORAGE_DIR
