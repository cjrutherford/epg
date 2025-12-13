import { Storage, File } from '@freearhey/storage-js'
import { Collection, Logger } from '@freearhey/core'
import { M3uParser } from 'm3u-parser-generator'
import { generateChannelsXML } from '../../core'
import { Channel } from '../../models'
import { Command } from 'commander'
import { data, loadData } from '../../api'
import axios from 'axios'

const program = new Command()
program
  .option('-i, --input <input>', 'Path to M3U file or URL')
  .option('-o, --output <output>', 'Output file path (default: channels.xml)')
  .option('--lang <lang>', 'Language code (default: en)')
  .parse(process.argv)

interface ParseOptions {
  input?: string
  output?: string
  lang?: string
}

const options: ParseOptions = program.opts()

async function main() {
  const storage = new Storage()
  const logger = new Logger()
  const lang = options.lang || 'en'
  const outputFilepath = options.output || 'channels.xml'

  if (!options.input) {
    logger.error('Error: --input parameter is required')
    process.exit(1)
  }

  logger.info(`Parsing M3U from: ${options.input}`)

  let m3uContent: string

  // Check if input is a URL or file path
  if (options.input.startsWith('http://') || options.input.startsWith('https://')) {
    logger.info('Downloading M3U from URL...')
    try {
      const response = await axios.get(options.input, {
        responseType: 'text',
        timeout: 60000
      })
      m3uContent = response.data
      logger.info(`Downloaded ${m3uContent.length} bytes`)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error(`Failed to download M3U: ${errorMessage}`)
      process.exit(1)
    }
  } else {
    // Load from file
    logger.info('Loading M3U from file...')
    m3uContent = await storage.load(options.input)
  }

  // Parse M3U content
  const parser = new M3uParser()
  const playlist = parser.parse(m3uContent)

  logger.info(`Found ${playlist.medias.length} channels in M3U file`)

  // Load API data to match channels with EPG sources
  logger.info('Loading API data to match channels with EPG sources...')
  await loadData()

  // Convert M3U media items to channels
  const channels = new Collection<Channel>()
  let matchedCount = 0
  let skippedCount = 0

  playlist.medias.forEach((media, index) => {
    // Use tvg-id if available
    const tvgId = media.attributes['tvg-id'] || ''
    const channelName = media.name || media.attributes['tvg-name'] || `Channel ${index + 1}`
    const channelLogo = media.attributes['tvg-logo'] || null
    const channelLang = media.attributes['tvg-language'] || lang

    // If no tvg-id, skip this channel as we can't match it to an EPG source
    if (!tvgId) {
      skippedCount++
      return
    }

    // Look up the channel in the API data
    const apiChannel = data.channelsKeyById.get(tvgId)
    
    if (!apiChannel) {
      logger.debug(`No API data found for channel: ${tvgId} (${channelName})`)
      skippedCount++
      return
    }

    // Get feeds for this channel
    const feeds = data.feedsGroupedByChannelId.get(tvgId) || []
    
    if (feeds.length === 0) {
      logger.debug(`No EPG feeds found for channel: ${tvgId} (${channelName})`)
      skippedCount++
      return
    }

    // Use the first feed (or could filter by language/quality)
    const feed = feeds[0]
    const site = feed.site
    const siteId = feed.site_id

    if (!site || !siteId) {
      logger.debug(`Invalid feed data for channel: ${tvgId} (${channelName})`)
      skippedCount++
      return
    }

    const channel = new Channel({
      xmltv_id: tvgId,
      name: channelName,
      site_id: siteId,
      lang: channelLang.toLowerCase(),
      logo: channelLogo,
      url: media.location,
      lcn: null,
      site: site,
      index: index
    })

    channels.add(channel)
    matchedCount++
  })

  logger.info(`Matched ${matchedCount} channels with EPG sources`)
  logger.info(`Skipped ${skippedCount} channels (no tvg-id or no EPG source available)`)

  if (channels.count() === 0) {
    logger.warn('No channels were matched! Make sure your M3U file has tvg-id attributes that match the iptv-org database.')
  }

  // Sort channels by site, language and name
  channels.sortBy([
    (channel: Channel) => channel.site || '_',
    (channel: Channel) => channel.lang || '_',
    (channel: Channel) => (channel.name ? channel.name.toLowerCase() : ''),
    (channel: Channel) => channel.site_id
  ])

  // Generate XML
  const xml = generateChannelsXML(channels)

  // Save to file
  await storage.save(outputFilepath, xml)

  logger.info(`Successfully created channels.xml with ${channels.count()} channels`)
  logger.info(`File saved to: ${outputFilepath}`)
}

main()
