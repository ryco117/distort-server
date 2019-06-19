FROM node:10.15.1-alpine
WORKDIR /usr/app

RUN apk --no-cache --virtual build-dependencies add \
    python \
    make \
    g++ \
    git \
    && git clone https://github.com/ryco117/distort-server && cd distort-server \
    && npm install \
    && apk del build-dependencies
