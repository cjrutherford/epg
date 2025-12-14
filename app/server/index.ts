
import Fastify from 'fastify'
import cors from '@fastify/cors'
import staticFiles from '@fastify/static'
import path from 'path'
import { loadChannels, searchChannels, saveSelection } from './channels'
import { runGrabProgrammatic } from '../../scripts/commands/epg/grab'
import { GrabberEngine } from './grabber/engine'
import { Scheduler } from './scheduler'
import fs from 'fs-extra'
import { spawn } from 'child_process'

// Configure Fastify logger; enable pino-pretty when PINO_PRETTY=1
const loggerLevel = process.env.LOG_LEVEL || 'info'
// Enable pretty pino output by default in non-production environments
const explicitPretty = process.env.PINO_PRETTY === '1' || process.env.PINO_PRETTY === 'true'
const implicitPretty = typeof process.env.PINO_PRETTY === 'undefined' && process.env.NODE_ENV !== 'production'
const usePretty = explicitPretty || implicitPretty

// Allow temporarily silencing Fastify request logs with FASTIFY_QUIET=1
// This will raise Fastify's minimum level to 'warn' to hide incoming/completed request messages.
const fastifyQuiet = process.env.FASTIFY_QUIET === '1' || process.env.FASTIFY_QUIET === 'true'
const fastifyLevel = fastifyQuiet ? 'warn' : loggerLevel

const loggerOptions: any = { level: fastifyLevel }
if (usePretty) {
  loggerOptions.transport = { target: 'pino-pretty', options: { colorize: true } }
  // eslint-disable-next-line no-console
  console.log('[Server] pino-pretty enabled for human-readable logs')
  if (fastifyQuiet) console.log('[Server] Fastify request logs are silenced (FASTIFY_QUIET=1)')
}

const server = Fastify({ logger: loggerOptions })

server.register(cors, {
  origin: '*'
})

// Serve static frontend
server.register(staticFiles, {
  root: path.join(process.cwd(), 'app/client/dist'),
  prefix: '/'
})

// Serve generated output
server.register(staticFiles, {
  root: path.join(process.cwd(), 'output'),
  prefix: '/output',
  decorateReply: false
})

const engine = new GrabberEngine()
const scheduler = new Scheduler(engine)

server.get('/api/channels', async (request, reply) => {
  const {
    q,
    countryOnly,
    lang,
    country,
    area,
    topic
  } = request.query as { q?: string; countryOnly?: string; lang?: string; country?: string; area?: string; topic?: string }

  // If any explicit filters are provided (or countryOnly), operate over the full channel set
  let channels = [] as any[]
  const hasAnyFilter = Boolean(lang || country || area || topic || countryOnly)
  if (!q && hasAnyFilter) {
    // load all channels then apply filters below
    channels = await loadChannels()
  } else {
    channels = await searchChannels(q || '', countryOnly === 'true')
  }

  // apply additional filters if provided
  if (lang) {
    channels = channels.filter(ch => (ch.lang || '').toLowerCase() === String(lang).toLowerCase())
  }
  if (country) {
    channels = channels.filter(ch => (ch.country || '').toLowerCase() === String(country).toLowerCase())
  }
  if (area) {
    channels = channels.filter(ch => {
      const val = (ch as any).area || (ch as any).broadcast_area || ''
      return String(val).toLowerCase().includes(String(area).toLowerCase())
    })
  }
  if (topic) {
    channels = channels.filter(ch => {
      const val = (ch as any).topic || (ch as any).topics || ''
      if (Array.isArray(val)) return val.map(String).join(',').toLowerCase().includes(String(topic).toLowerCase())
      return String(val).toLowerCase().includes(String(topic).toLowerCase())
    })
  }

  return channels
})

// Return count of channels matching current filters
server.get('/api/channels/count', async (request, reply) => {
  const {
    q,
    countryOnly,
    lang,
    country,
    area,
    topic
  } = request.query as { q?: string; countryOnly?: string; lang?: string; country?: string; area?: string; topic?: string }

  let channels = [] as any[]
  const hasAnyFilter = Boolean(lang || country || area || topic || countryOnly)
  if (!q && hasAnyFilter) {
    channels = await loadChannels()
  } else {
    channels = await searchChannels(q || '', countryOnly === 'true')
  }

  // apply filters
  if (lang) channels = channels.filter(ch => (ch.lang || '').toLowerCase() === String(lang).toLowerCase())
  if (country) channels = channels.filter(ch => (ch.country || '').toLowerCase() === String(country).toLowerCase())
  if (area) channels = channels.filter(ch => {
    const val = (ch as any).area || (ch as any).broadcast_area || ''
    return String(val).toLowerCase().includes(String(area).toLowerCase())
  })
  if (topic) channels = channels.filter(ch => {
    const val = (ch as any).topic || (ch as any).topics || ''
    if (Array.isArray(val)) return val.map(String).join(',').toLowerCase().includes(String(topic).toLowerCase())
    return String(val).toLowerCase().includes(String(topic).toLowerCase())
  })

  return { count: channels.length }
})

// Return all matching channel ids (xmltvId) for current filters
server.get('/api/channels/ids', async (request, reply) => {
  const {
    q,
    countryOnly,
    lang,
    country,
    area,
    topic
  } = request.query as { q?: string; countryOnly?: string; lang?: string; country?: string; area?: string; topic?: string }

  let channels = [] as any[]
  const hasAnyFilter = Boolean(lang || country || area || topic || countryOnly)
  if (!q && hasAnyFilter) {
    channels = await loadChannels()
  } else {
    channels = await searchChannels(q || '', countryOnly === 'true')
  }

  // apply filters (same as /api/channels)
  if (lang) channels = channels.filter(ch => (ch.lang || '').toLowerCase() === String(lang).toLowerCase())
  if (country) channels = channels.filter(ch => (ch.country || '').toLowerCase() === String(country).toLowerCase())
  if (area) channels = channels.filter(ch => {
    const val = (ch as any).area || (ch as any).broadcast_area || ''
    return String(val).toLowerCase().includes(String(area).toLowerCase())
  })
  if (topic) channels = channels.filter(ch => {
    const val = (ch as any).topic || (ch as any).topics || ''
    if (Array.isArray(val)) return val.map(String).join(',').toLowerCase().includes(String(topic).toLowerCase())
    return String(val).toLowerCase().includes(String(topic).toLowerCase())
  })

  return channels.map(ch => ch.xmltvId)
})

server.post('/api/channels/select', async (request, reply) => {
  const { ids } = request.body as { ids: string[] }
  if (!Array.isArray(ids)) {
    return reply.status(400).send({ error: 'ids must be an array' })
  }
  
  const outDir = path.resolve(process.cwd(), 'output')
  const result = await saveSelection(ids, outDir)

  // write the selected ids file into output for persistence
  await fs.writeJson(path.join(outDir, 'selected_ids.json'), ids)

  // expose served URLs for the generated files (server mounts /output -> ./output)
  const m3uName = path.basename(result.m3uPath || '')
  const xmlName = path.basename(result.channelsXmlPath || '')
  const m3uUrl = m3uName ? `/output/${m3uName}` : null
  const channelsXmlUrl = xmlName ? `/output/${xmlName}` : null

  return { ids, m3uUrl, channelsXmlUrl }
})

// Return saved selection (if exists)
server.get('/api/selection', async (request, reply) => {
  const outDir = path.resolve(process.cwd(), 'output')
  const selectedIdsPath = path.join(outDir, 'selected_ids.json')
  try {
    if (await fs.pathExists(selectedIdsPath)) {
      const ids = await fs.readJson(selectedIdsPath)
      // detect generated files
      const m3uPath = path.join(outDir, 'api.selected.channels.m3u')
      const xmlPath = path.join(outDir, 'api.selected.channels.xml')
      const m3uUrl = (await fs.pathExists(m3uPath)) ? `/output/${path.basename(m3uPath)}` : null
      const channelsXmlUrl = (await fs.pathExists(xmlPath)) ? `/output/${path.basename(xmlPath)}` : null
      // also return rich channel details for the client to render names
      try {
        const allChannels = await loadChannels()
        const selectedChannels = allChannels.filter((c: any) => ids.includes(c.xmltvId))
        return { ids, m3uUrl, channelsXmlUrl, channels: selectedChannels }
      } catch (e) {
        return { ids, m3uUrl, channelsXmlUrl }
      }
    }
  } catch (e) {}
  return { ids: [] }
})

server.get('/api/status', async (request, reply) => {
    return engine.getStatus()
})

// Return canonical filter lists (langs, countries, areas, topics) from full dataset
server.get('/api/channels/filters', async (request, reply) => {
  try {
    const all = await loadChannels()
    const langs = new Set<string>()
    const countries = new Set<string>()
    const areas = new Set<string>()
    const topics = new Set<string>()

    for (const ch of all) {
      if (ch.lang) langs.add(ch.lang)
      if (ch.country) countries.add(ch.country)
      const area = (ch as any).area || (ch as any).broadcast_area
      if (area) areas.add(area)
      const t = (ch as any).topic || (ch as any).topics
      if (Array.isArray(t)) for (const tt of t) topics.add(tt)
      else if (t) topics.add(t)
    }

    return {
      langs: Array.from(langs).sort(),
      countries: Array.from(countries).sort(),
      areas: Array.from(areas).sort(),
      topics: Array.from(topics).sort()
    }
  } catch (e) {
    request.log.warn('Failed to build filters', e)
    return { langs: [], countries: [], areas: [], topics: [] }
  }
})

// Provide job/queue stats
server.get('/api/jobs', async (request, reply) => {
  const status = engine.getStatus()
  // queue stats
  const { getStats } = await import('./grabber/queue')
  const queueStats = getStats()
  return { status, queueStats }
})

// Server-Sent Events endpoint for live grabber events
server.get('/api/events', async (request, reply) => {
  const res = reply.raw
  // Use writeHead to set status + headers for a streaming response
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })
  res.write('\n')

  const send = (event: string, data: any) => {
    try {
      res.write(`event: ${event}\n`)
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    } catch (e) {
      // ignore
    }
  }

  const onJob = (payload: any) => send('job:update', payload)
  const onRunStart = (payload: any) => send('run:start', payload)
  const onRunDone = (payload: any) => send('run:done', payload)
  const onError = (payload: any) => send('error', payload)

  engine.emitter.on('job:update', onJob)
  engine.emitter.on('run:start', onRunStart)
  engine.emitter.on('run:done', onRunDone)
  engine.emitter.on('error', onError)

  request.raw.on('close', () => {
    engine.emitter.off('job:update', onJob)
    engine.emitter.off('run:start', onRunStart)
    engine.emitter.off('run:done', onRunDone)
    engine.emitter.off('error', onError)
    try { res.end() } catch (e) {}
  })

  // Do not return reply.raw (Fastify may attempt to pipe it). Keep the connection open.
  return reply
})

// Trigger api:load (runs `tsx scripts/commands/api/load.ts`) in background
server.post('/api/load', async (request, reply) => {
  try {
    // Spawn npm script to load API data. Run detached so server doesn't wait.
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'api:load'], {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore'
    })
    child.unref()
    return { status: 'started' }
  } catch (e) {
    request.log.error(e)
    return reply.status(500).send({ error: 'failed to start load' })
  }
})

server.post('/api/grab', async (request, reply) => {
  // Start programmatic grab in-process (non-blocking) using the CLI logic
  const outDir = path.resolve(process.cwd(), 'output')
  const selectedIdsPath = path.join(outDir, 'selected_ids.json')
  let ids: string[] = []
  try {
    if (await fs.pathExists(selectedIdsPath)) ids = await fs.readJson(selectedIdsPath)
  } catch (e) { ids = [] }

  // Determine channels XML path if available
  const channelsXmlPath = path.join(outDir, 'api.selected.channels.xml')
  const channelsArg = (await fs.pathExists(channelsXmlPath)) ? channelsXmlPath : undefined

  // Fire-and-forget the grab; emit SSE events for clients
  reply.send({ status: 'started' })
  ;(async () => {
    try {
      server.log.info('[Server] Starting programmatic grab')
      engine.emitter.emit('run:start', { context: 'manual', total: ids.length })
      // pass debug flag to CLI runner when LOG_LEVEL=debug so we get verbose output
      const grabOptions: any = { channels: channelsArg }
      if ((process.env.LOG_LEVEL || '').toLowerCase() === 'debug') grabOptions.debug = true
      await runGrabProgrammatic(grabOptions)
      // TODO: the runner could return a summary; emit placeholder for now
      engine.emitter.emit('run:done', { successful: 0, failed: 0 })
      server.log.info('[Server] programmatic grab finished')
    } catch (err: any) {
      server.log.error(err)
      // record full stack in our human-readable grabber log and emit it via SSE
      try {
        const { error: logError } = await import('./log')
        logError('[ProgrammaticGrab] Error', err.stack || String(err))
      } catch (e) {
        // fallback: console
        // eslint-disable-next-line no-console
        console.error('[ProgrammaticGrab] Error', err)
      }
      engine.emitter.emit('error', { error: String(err), stack: err.stack })
    }
  })()
  return
})

const start = async () => {
  try {
    scheduler.start()
    // Ensure saved selection outputs exist on startup (m3u + channels xml)
    try {
      const outDir = path.resolve(process.cwd(), 'output')
      const selectedIdsPath = path.join(outDir, 'selected_ids.json')
      if (await fs.pathExists(selectedIdsPath)) {
        const ids = await fs.readJson(selectedIdsPath)
        if (Array.isArray(ids) && ids.length) {
          await saveSelection(ids, outDir)
          server.log.info('[Server] Regenerated selection M3U and channels XML on startup')
        }
      }
    } catch (e) { server.log.warn('Failed to regenerate selection outputs on startup', e) }

    await server.listen({ port: 3000, host: '0.0.0.0' })
    console.log('Server started at http://localhost:3000')
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

start()
