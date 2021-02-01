FROM node:14

COPY ./run_inside_container.sh /run_inside_container.sh

RUN npm install -g kachery-p2p-daemon@0.5.23

ENTRYPOINT [ "/run_inside_container.sh" ]