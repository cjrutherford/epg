import { Storage, File } from '@freearhey/storage-js'
import { Collection, Logger } from '@freearhey/core'
import { M3uParser } from 'm3u-parser-generator'
import { generateChannelsXML } from '../../core'
import { Channel } from '../../models'
import { Command } from 'commander'
import axios from 'axios'

const program = new Command()
program
  .option('-i, --input <input>', 'Path to M3U file or URL')
  .option('-o, --output <output>', 'Output file path (default: channels.xml)')
  .option('--site <site>', 'Site identifier (default: m3u)')
  .option('--lang <lang>', 'Language code (default: en)')
  .parse(process.argv)

interface ParseOptions {
  input?: string
  output?: string
  site?: string
  lang?: string
}

const options: ParseOptions = program.opts()

async function main() {
  const storage = new Storage()
  const logger = new Logger()
  const site = options.site || 'm3u'
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

  // Convert M3U media items to channels
  const channels = new Collection<Channel>()
  playlist.medias.forEach((media, index) => {
    // Use tvg-id if available, otherwise use the channel name or location as identifier
    const tvgId = media.attributes['tvg-id'] || ''
    const channelName = media.name || media.attributes['tvg-name'] || `Channel ${index + 1}`
    const channelLogo = media.attributes['tvg-logo'] || null
    const channelLang = media.attributes['tvg-language'] || lang
    
    // Create a unique site_id from tvg-id or channel name
    const siteId = tvgId || channelName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()

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
  })

  // Sort channels by language and name
  channels.sortBy([
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
