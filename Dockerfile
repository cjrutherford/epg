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
    && npm install \
    && mkdir -p public temp/data
RUN apk del git curl \
  && rm -rf /var/cache/apk/*
COPY pm2.config.js $WORKDIR
COPY scripts/docker-startup.sh $WORKDIR
RUN chmod +x $WORKDIR/docker-startup.sh
WORKDIR $WORKDIR
EXPOSE 3000
CMD [ "./docker-startup.sh" ]