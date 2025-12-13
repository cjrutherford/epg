import { Storage, File } from '@freearhey/storage-js'
import { Collection, Logger } from '@freearhey/core'
import { M3uParser } from 'm3u-parser-generator'
import { generateChannelsXML } from '../../core'
import { Channel } from '../../models'
import { Command } from 'commander'
import { data, loadData, searchChannels } from '../../api'
import epgGrabber, { EPGGrabber } from 'epg-grabber'
import { SITES_DIR } from '../../constants'
import axios from 'axios'

const program = new Command()
program
  .option('-i, --input <input>', 'Path to M3U file or URL')
  .option('-o, --output <output>', 'Output file path (default: channels.xml)')
  .option('--enriched-m3u <path>', 'Output path for enriched M3U file (default: enriched.m3u)')
  .option('--lang <lang>', 'Language code (default: en)')
  .parse(process.argv)

interface ParseOptions {
  input?: string
  output?: string
  enrichedM3u?: string
  lang?: string
}

const options: ParseOptions = program.opts()

async function main() {
  const storage = new Storage()
  const logger = new Logger()
  const lang = options.lang || 'en'
  const outputFilepath = options.output || 'channels.xml'
  const enrichedM3uPath = options.enrichedM3u || 'enriched.m3u'

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

  // Load all existing channels from sites to find site/site_id mappings
  logger.info('Loading existing site configurations...')
  const sitesStorage = new Storage(SITES_DIR)
  const siteFiles: string[] = await sitesStorage.list('**/*.channels.xml')
  
  // Build a map of xmltv_id -> {site, site_id, name}
  const xmltvIdToSiteMap = new Map<string, { site: string; site_id: string; site_name: string }>()
  
  for (const filepath of siteFiles) {
    try {
      const xml = await sitesStorage.load(filepath)
      const parsedChannels = EPGGrabber.parseChannelsXML(xml)
      
      parsedChannels.forEach((ch: epgGrabber.Channel) => {
        if (ch.xmltv_id && ch.site && ch.site_id) {
          // Store the first occurrence of each xmltv_id
          if (!xmltvIdToSiteMap.has(ch.xmltv_id)) {
            xmltvIdToSiteMap.set(ch.xmltv_id, {
              site: ch.site,
              site_id: ch.site_id,
              site_name: ch.name
            })
          }
        }
      })
    } catch (error) {
      // Skip files that can't be parsed
      logger.debug(`Could not parse ${filepath}`)
    }
  }
  
  logger.info(`Loaded ${xmltvIdToSiteMap.size} channel mappings from sites`)

  // Convert M3U media items to channels and build enriched M3U
  const channels = new Collection<Channel>()
  const enrichedM3uLines: string[] = ['#EXTM3U']
  let matchedCount = 0
  let skippedCount = 0

  playlist.medias.forEach((media, index) => {
    // Use tvg-id if available
    const tvgId = media.attributes['tvg-id'] || ''
    const channelName = media.name || media.attributes['tvg-name'] || `Channel ${index + 1}`
    const channelLogo = media.attributes['tvg-logo'] || null
    const channelLang = media.attributes['tvg-language'] || lang

    let apiChannel = null
    let matchMethod = ''

    // Try to match by tvg-id first
    if (tvgId) {
      apiChannel = data.channelsKeyById.get(tvgId)
      if (apiChannel) {
        matchMethod = 'tvg-id'
      }
    }

    // If no match by tvg-id, try to search by channel name
    if (!apiChannel && channelName) {
      const searchResults = searchChannels(channelName)
      if (searchResults.count() > 0) {
        // Use the first search result
        apiChannel = searchResults.first()
        matchMethod = 'name'
      }
    }
    
    if (!apiChannel) {
      logger.debug(`No API data found for channel: ${tvgId || channelName}`)
      
      // Add to enriched M3U without tvg-id (unmatched)
      let extinf = '#EXTINF:-1'
      if (channelLogo) extinf += ` tvg-logo="${channelLogo}"`
      if (channelLang) extinf += ` tvg-language="${channelLang}"`
      extinf += `,${channelName}`
      enrichedM3uLines.push(extinf)
      enrichedM3uLines.push(media.location)
      
      skippedCount++
      return
    }

    // Look up site/site_id mapping for this channel
    const siteMapping = xmltvIdToSiteMap.get(apiChannel.id)
    
    if (!siteMapping) {
      logger.debug(`No site mapping found for channel: ${apiChannel.id} (${channelName})`)
      
      // Add to enriched M3U with tvg-id but no EPG source
      let extinf = '#EXTINF:-1'
      extinf += ` tvg-id="${apiChannel.id}"`
      if (channelLogo) extinf += ` tvg-logo="${channelLogo}"`
      if (channelLang) extinf += ` tvg-language="${channelLang}"`
      extinf += `,${channelName}`
      enrichedM3uLines.push(extinf)
      enrichedM3uLines.push(media.location)
      
      skippedCount++
      return
    }

    logger.debug(`Matched channel "${channelName}" by ${matchMethod} -> ${siteMapping.site}/${siteMapping.site_id}`)

    // Add to enriched M3U with full tvg-id
    let extinf = '#EXTINF:-1'
    extinf += ` tvg-id="${apiChannel.id}"`
    if (channelLogo) extinf += ` tvg-logo="${channelLogo}"`
    if (channelLang) extinf += ` tvg-language="${channelLang}"`
    extinf += `,${channelName}`
    enrichedM3uLines.push(extinf)
    enrichedM3uLines.push(media.location)

    // Add to channels.xml for EPG grab
    const channel = new Channel({
      xmltv_id: apiChannel.id,
      name: channelName,
      site_id: siteMapping.site_id,
      lang: channelLang.toLowerCase(),
      logo: channelLogo,
      url: media.location,
      lcn: null,
      site: siteMapping.site,
      index: index
    })

    channels.add(channel)
    matchedCount++
  })

  logger.info(`Matched ${matchedCount} channels with EPG sources (by tvg-id or name)`)
  logger.info(`Skipped ${skippedCount} channels (no match found or no EPG source available)`)
  logger.info(`Total ${playlist.medias.length} channels in enriched M3U`)

  if (channels.count() === 0) {
    logger.warn('No channels were matched! Channels are matched by tvg-id or name against the iptv-org database.')
  }

  // Sort channels by site, language and name
  channels.sortBy([
    (channel: Channel) => channel.site || '_',
    (channel: Channel) => channel.lang || '_',
    (channel: Channel) => (channel.name ? channel.name.toLowerCase() : ''),
    (channel: Channel) => channel.site_id
  ])

  // Generate and save enriched M3U
  const enrichedM3uContent = enrichedM3uLines.join('\n') + '\n'
  await storage.save(enrichedM3uPath, enrichedM3uContent)
  logger.info(`Enriched M3U saved to: ${enrichedM3uPath}`)

  // Generate and save channels.xml
  const xml = generateChannelsXML(channels)
  await storage.save(outputFilepath, xml)
  logger.info(`Channels XML saved to: ${outputFilepath} (${channels.count()} channels with EPG)`)
}

main()
