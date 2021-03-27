#!/bin/bash

DIRECTORY=$PWD
rm *.tar.gz
cd ../..
git archive -v -o $DIRECTORY/kachery-p2p.tar.gz --format=tar.gz HEAD
cd $DIRECTORY

docker build -t kachery-p2p-test .