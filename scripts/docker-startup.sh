#!/bin/bash
set -e

echo "Starting EPG Docker container..."

# Load API data if RUN_AT_STARTUP is true
if [ "$RUN_AT_STARTUP" = "true" ]; then
  echo "Loading API data..."
  npm run api:load || echo "Warning: Failed to load API data"
  
  # Check if M3U_URL is provided
  if [ -n "$M3U_URL" ]; then
    echo "Parsing M3U from URL: $M3U_URL"
    npm run m3u:parse -- --input="$M3U_URL" --output=channels.xml ${M3U_LANG:+--lang="$M3U_LANG"} || echo "Warning: Failed to parse M3U"
  fi
  
  echo "Running initial EPG grab..."
  if [ -n "$SITE" ]; then
    npm run grab -- --site="$SITE" ${CLANG:+--lang="$CLANG"} --output=public/guide.xml || echo "Warning: Initial grab failed"
  else
    npm run grab -- --channels=channels.xml --output=public/guide.xml || echo "Warning: Initial grab failed"
  fi
fi

echo "Starting PM2 services..."
exec pm2-runtime pm2.config.js
