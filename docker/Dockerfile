FROM node:15

COPY ./run_inside_container.sh /run_inside_container.sh

RUN npm install -g kachery-p2p-daemon@0.8.8

ENTRYPOINT [ "/run_inside_container.sh" ]