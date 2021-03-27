#!/bin/bash

set -ex

echo "Building daemon"

rm -rf kachery_p2p/*.tgz
rm -rf daemon/*.tgz
cd daemon
yarn install
yarn build
npm pack
cp kachery-p2p-daemon-*.tgz ../kachery_p2p/