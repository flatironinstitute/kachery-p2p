FROM nikolaik/python-nodejs:python3.8-nodejs15

RUN pip install numpy

ADD kachery-p2p.tar.gz /src/kachery-p2p
WORKDIR /src/kachery-p2p
RUN .vscode/tasks/build_daemon.sh
RUN pip install .

COPY ./inside_container /inside_container