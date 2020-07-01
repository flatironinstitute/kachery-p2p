FROM nikolaik/python-nodejs:python3.7-nodejs12

RUN pip install kachery==0.6.3

RUN mkdir /daemon
COPY package.json /daemon/package.json
COPY src /daemon/src
COPY bin /daemon/bin
WORKDIR /daemon
RUN npm install

ENTRYPOINT npm run start-docker