FROM node:10.15.1-alpine
WORKDIR /usr/app
COPY . .

RUN apk --no-cache --virtual build-dependencies add \
    python \
    make \
    g++ \
    git \
    && npm install \
    && make \
    && apk del build-dependencies
