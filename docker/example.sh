#!/bin/bash

KACHERY_STORAGE_DIR=/some/storage/dir
KACHERY_P2P_CONFIG_DIR=/some/config/dir
KACHERY_P2P_VERSION=0.6.11
HTTP_LISTEN_PORT=
PUBLIC_URL=
LABEL=node-label

OPTS=""
OPTS="$OPTS -v $KACHERY_STORAGE_DIR:/data/kachery-storage"
OPTS="$OPTS -v $KACHERY_P2P_CONFIG_DIR:/data/kachery-p2p-config"
if [ -n "$HTTP_LISTEN_PORT" ]
then
	OPTS="$OPTS -p $HTTP_LISTEN_PORT:$HTTP_LISTEN_PORT"
fi
OPTS="$OPTS -it magland/kachery-p2p:$KACHERY_P2P_VERSION"
OPTS="$OPTS --label $LABEL"
if [ -n "$HTTP_LISTEN_PORT" ]
then
	OPTS="$OPTS --http-port $HTTP_LISTEN_PORT"
fi
if [ -n "$PUBLIC_URL" ]
then
	OPTS="$OPTS --public-url $PUBLIC_URL"
fi
OPTS="$OPTS --noudp"

docker run $OPTS
