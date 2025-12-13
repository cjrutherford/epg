module.exports = {
  site: 'm3u',
  days: 1,
  url: function ({ channel }) {
    return channel.url
  },
  parser: function ({ content }) {
    // M3U channels don't have EPG data in the M3U file itself
    // This is just a placeholder parser that returns empty programs
    // Users should use channels with proper EPG sources
    return []
  }
}
