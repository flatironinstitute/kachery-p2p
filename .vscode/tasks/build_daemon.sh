#!/bin/bash

set -ex

cd daemon
yarn install
yarn build
npm pack
cp kachery-p2p-daemon-*.tgz ../kachery_p2p/