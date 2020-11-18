#!/bin/bash

export KACHERY_STORAGE_DIR=/data/kachery-storage
export KACHERY_P2P_CONFIG_DIR=/data/kachery-p2p-config

if [ ! -d "$KACHERY_STORAGE_DIR" ]
then
    echo "Directory does not exist: $KACHERY_STORAGE_DIR"
    exit 1
fi

if [ ! -d "$KACHERY_P2P_CONFIG_DIR" ]
then
    echo "Directory does not exist: $KACHERY_P2P_CONFIG_DIR"
    exit 1
fi

kachery-p2p-daemon start "$@"