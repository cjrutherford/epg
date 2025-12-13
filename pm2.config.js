// Build command for M3U parsing if M3U_URL is provided
const parseM3u = process.env.M3U_URL
  ? `npm run m3u:parse -- --input="${process.env.M3U_URL}" --output=channels.xml --enriched-m3u=public/playlist.m3u ${process.env.M3U_LANG ? `--lang="${process.env.M3U_LANG}"` : ''} && `
  : ''

const grab = process.env.SITE
  ? `npm run grab -- --site=${process.env.SITE} ${process.env.CLANG ? `--lang=${process.env.CLANG}` : ''
  } --output=public/guide.xml`
  : 'npm run grab -- --channels=channels.xml --output=public/guide.xml'

// Combine M3U parsing with grab for scheduled runs
const scheduledCommand = `${parseM3u}${grab}`

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
    script: `npx chronos -e "${scheduledCommand}" -p "${process.env.CRON_SCHEDULE}" -l`,
    instances: 1,
    watch: false,
    autorestart: true
  }
];

module.exports = { apps };