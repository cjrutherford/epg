const grab = process.env.SITE
  ? `npm run grab -- --site=${process.env.SITE} ${process.env.CLANG ? `--lang=${process.env.CLANG}` : ''
  } --output=public/guide.xml`
  : 'npm run grab -- --channels=channels.xml --output=public/guide.xml'


const apps = [
  {
    name: 'serve',
    script: 'npx serve -- public',
    instances: 1,
    watch: false,
    autorestart: true
  },
  {
    name: 'grab',
    script: `npx chronos -e "${grab}" -p "${process.env.CRON_SCHEDULE}" -l`,
    instances: 1,
    watch: false,
    autorestart: true
  }
];

// Load API data on startup
if (process.env.RUN_AT_STARTUP === 'true') {
  apps.push({
    name: 'load-api-data',
    script: 'npm run api:load',
    instances: 1,
    autorestart: false,
    watch: false,
    max_restarts: 1
  });
  apps.push({
    name: 'grab-at-startup',
    script: grab,
    instances: 1,
    autorestart: false,
    watch: false,
    max_restarts: 1
  });
}

module.exports = { apps };