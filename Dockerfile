FROM node:10.15.1-alpine
WORKDIR /usr/app
COPY package.json ./
COPY package-lock.json ./
COPY config.json ./
COPY ./src ./src

RUN apk --no-cache --virtual build-dependencies add \
    python \
    make \
    g++ \
    && npm install \
    && apk del build-dependencies

CMD ["npm", "start"]