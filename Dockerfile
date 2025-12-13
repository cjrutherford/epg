FROM node:22-alpine
ARG GIT_REPO=https://github.com/iptv-org/epg.git
ARG GIT_BRANCH=master
ARG WORKDIR=/epg
ENV CRON_SCHEDULE="0 0 * * *"
ENV RUN_AT_STARTUP=true
RUN apk update \
    && apk upgrade --available \
    && apk add curl git tzdata bash \
    && npm install -g npm@latest \
    && npm install pm2 -g \
    && mkdir $(echo "${WORKDIR}") -p \
    && cd $WORKDIR \
    && git clone --depth 1 -b $(echo "${GIT_BRANCH} ${GIT_REPO}") . \
    && mkdir -p public temp/data
# Copy updated files from fork
COPY package.json $WORKDIR/package.json
COPY package-lock.json $WORKDIR/package-lock.json
COPY pm2.config.js $WORKDIR/pm2.config.js
COPY scripts/docker-startup.sh $WORKDIR/scripts/docker-startup.sh
COPY scripts/commands/m3u/ $WORKDIR/scripts/commands/m3u/
# Install dependencies with updated package files
RUN cd $WORKDIR && npm install
RUN chmod +x $WORKDIR/scripts/docker-startup.sh
RUN apk del git curl \
  && rm -rf /var/cache/apk/*
WORKDIR $WORKDIR
EXPOSE 3000
CMD [ "./scripts/docker-startup.sh" ]