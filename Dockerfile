FROM node:10.15.1-alpine
WORKDIR /usr/app
COPY package.json .

RUN apk --no-cache --virtual build-dependencies add \
    python \
    make \
    g++ \
    && npm install \
    && apk del build-dependencies

COPY . .
