FROM node:22-alpine
ARG WORKDIR=/epg
ENV CRON_SCHEDULE="0 0 * * *"
ENV RUN_AT_STARTUP=true

# Install system dependencies
RUN apk update \
    && apk upgrade --available \
    && apk add tzdata bash \
    && npm install -g npm@latest pm2 \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR $WORKDIR

# Copy application files
COPY package.json package-lock.json $WORKDIR/
COPY scripts/ $WORKDIR/scripts/
COPY sites/ $WORKDIR/sites/
COPY tests/ $WORKDIR/tests/
COPY pm2.config.js tsconfig.json eslint.config.mjs .prettierrc.js $WORKDIR/

# Install dependencies and create necessary directories
RUN npm install && mkdir -p public temp/data

# Make startup script executable
RUN chmod +x $WORKDIR/scripts/docker-startup.sh

# Expose port
EXPOSE 3000

# Start the application
CMD [ "./scripts/docker-startup.sh" ]