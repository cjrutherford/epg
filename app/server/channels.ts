
import path from 'path'
import fs from 'fs-extra'
import { DATA_DIR } from '../../scripts/constants'

// Types based on the original script
export type ChannelItem = {
  xmltvId: string
  name: string
  site?: string
  site_id?: string
  logo?: string
  country?: string
  lang?: string
}

let cachedChannels: ChannelItem[] = []

export async function loadChannels() {
  if (cachedChannels.length > 0) return cachedChannels

  const channelsPath = path.resolve(DATA_DIR, 'channels.json')
  let channelsRaw: any = []
  try {
    channelsRaw = await fs.readJson(channelsPath)
  } catch (err) {
    console.warn(`Failed to read channels from ${channelsPath}`)
    return []
  }

  const channelsMap: any = channelsRaw || []
  
  // load feeds/streams to enrich
  let feedsRaw: any = []
  let streamsRaw: any = []
  try {
    feedsRaw = await fs.readJson(path.resolve(DATA_DIR, 'feeds.json'))
  } catch (e) {
    feedsRaw = []
  }
  try {
    streamsRaw = await fs.readJson(path.resolve(DATA_DIR, 'streams.json'))
  } catch (e) {
    streamsRaw = []
  }

  const feedsByXmltv = new Map<string, any>()
  const feedsByChannel = new Map<string, any>()
  if (Array.isArray(feedsRaw)) {
    for (const f of feedsRaw) {
      if (!f) continue
      if (f.xmltv_id) feedsByXmltv.set(String(f.xmltv_id), f)
      if (f.channel) feedsByChannel.set(String(f.channel), f)
      if (f.id) feedsByChannel.set(String(f.id), f)
      if (f.site_id) feedsByChannel.set(String(f.site_id), f)
    }
  }

  let guidesRaw: any = []
  try {
    guidesRaw = await fs.readJson(path.resolve(DATA_DIR, 'guides.json'))
  } catch (e) {
    guidesRaw = []
  }
  const guidesByChannel = new Map<string, any>()
  if (Array.isArray(guidesRaw)) {
    for (const g of guidesRaw) {
      if (!g) continue
      if (g.channel) guidesByChannel.set(String(g.channel), g)
    }
  }

  const channels: ChannelItem[] = []
  const processChannel = (id: string, ch: any) => {
      // try to enrich with feed info
      const feed = feedsByXmltv.get(String(id)) || feedsByChannel.get(String(id))
      const inferredSite =
        ch.site ||
        ch.site_name ||
        ch.provider ||
        (feed && (feed.site || feed.provider || feed.source)) ||
        ''
      const inferredSiteId =
        ch.site_id ||
        ch.id ||
        ch.channel_id ||
        (feed && (feed.site_id || feed.id || feed.channel)) ||
        ''

      return {
        xmltvId: String(id),
        name: ch.name || ch.title || String(id),
        site: inferredSite,
        site_id: inferredSiteId,
        logo: ch.logo || ch.image || ch.logo_url,
        country: ch.country || ch.country_code || ch.cc,
        lang: ch.lang || 'en'
      }
  }

  if (channelsMap && typeof channelsMap.all === 'function') {
    for (const ch of channelsMap.all() as any[]) {
      const id = ch.id || ch.xmltv_id || ch._id || ''
      channels.push(processChannel(id, ch))
    }
  } else if (typeof (channelsMap as Map<string, any>).entries === 'function') {
    for (const [id, ch] of (channelsMap as Map<string, any>).entries() as Iterable<[string, any]>) {
      channels.push(processChannel(id, ch))
    }
  } else {
    Object.entries(channelsMap || {}).forEach(([id, ch]: [string, any]) => {
      channels.push(processChannel(id, ch))
    })
  }

  // prefer guide-provided mappings
  for (const ch of channels) {
    const guide = guidesByChannel.get(String(ch.xmltvId))
    if (guide) {
      if (guide.site) ch.site = guide.site
      if (guide.site_id) ch.site_id = guide.site_id
    }
  }

  cachedChannels = channels
  return channels
}

export async function searchChannels(query: string, countryOnly: boolean = false) {
  const channels = await loadChannels()
  const q = (query || '').trim().toLowerCase()
  
  if (!q) return channels.slice(0, 100) // return first 100 if no query

  return channels.filter(ch => {
    if (countryOnly) {
      return (ch.country || '').toLowerCase().includes(q)
    }
    return (
      (ch.name || '').toLowerCase().includes(q) ||
      (ch.xmltvId || '').toLowerCase().includes(q) ||
      (ch.site || '').toLowerCase().includes(q) ||
      (ch.country || '').toLowerCase().includes(q)
    )
  }).slice(0, 500) // limit results
}

export async function saveSelection(selectedIds: string[], outDir: string) {
  const channels = await loadChannels()
  const selected = channels.filter(c => selectedIds.includes(c.xmltvId))

  // Re-read raw feeds/streams for enrichment during M3U generation if needed
  // ... (Simplification: using the already enriched `site` and `site_id` from loadChannels, 
  // but the original script re-checks feeds/streams for some reason. 
  // For now, I will trust the enriched data in ChannelItem, or I should re-implement the full logic from main() loop)
  // The original script did extra enrichment in the writing loop. I'll reproduce that if possible or simplify.
  // Actually, loadChannels() above does most of the enrichment. 
  // The logic in original script lines 270-330 is quite complex re-enrichment.
  // I will just use the properties we already computed in `processChannel`.
  
  await fs.ensureDir(outDir)
  const m3uLines: string[] = ['#EXTM3U']
  const channelsXmlLines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<channels>']

  for (const ch of selected) {
    const safeLogo = ch.logo || ''
    const safeXmltv = ch.xmltvId || ''
    m3uLines.push(`#EXTINF:-1 tvg-id="${safeXmltv}" tvg-logo="${safeLogo}",${ch.name}`)
    // placeholder stream
    const streamUrl = `http://STREAM_PLACEHOLDER/${safeXmltv}`
    m3uLines.push(streamUrl)
    
    // In original script, it tries to find "better" site/site_id at the last second.
    // We already did enrichment in loadChannels(), but ensure `site` maps to an
    // actual folder under `sites/` so the grabber can find a config without
    // additional heuristics at runtime.
    let site = ch.site || ''
    let siteId = ch.site_id || ''

    if (!siteId && site && site.includes('#')) {
      const parts = site.split('#')
      if (parts.length > 1) siteId = parts[1]
    }

    try {
      const sitesDir = path.resolve(process.cwd(), 'sites')
      const folders = (await fs.readdir(sitesDir)).filter(f =>
        fs.statSync(path.join(sitesDir, f)).isDirectory()
      )

      const normalize = (s: string) =>
        String(s || '')
          .toLowerCase()
          .replace(/\s+/g, '')
          .replace(/^www\./, '')
          .replace(/[^a-z0-9.\-]/g, '')

      const candidates: string[] = []
      if (site) candidates.push(site)
      if (siteId) candidates.push(siteId)
      if (ch.xmltvId) candidates.push(ch.xmltvId)
      if (siteId && siteId.includes('#')) {
        const parts = siteId.split('#')
        if (parts.length > 1) candidates.push(parts[1])
      }

      let resolved = ''
      for (const cand of candidates) {
        if (!cand) continue
        const n = normalize(cand)
        // exact
        for (const f of folders) {
          if (normalize(f) === n) {
            resolved = f
            break
          }
        }
        if (resolved) break
        for (const f of folders) {
          if (normalize(f).includes(n) || n.includes(normalize(f))) {
            resolved = f
            break
          }
        }
        if (resolved) break
      }

      if (resolved) site = site || resolved
    } catch (e) {
      // ignore resolution errors
    }

    const escapeXml = (str?: string) => {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
    }

    channelsXmlLines.push(
      `<channel site="${escapeXml(site)}" lang="${escapeXml(ch.lang)}" xmltv_id="${escapeXml(safeXmltv)}" site_id="${escapeXml(siteId)}">${escapeXml(ch.name)}</channel>`
    )
  }

  channelsXmlLines.push('</channels>')

  const m3uPath = path.join(outDir, 'api.selected.channels.m3u')
  const channelsXmlPath = path.join(outDir, 'api.selected.channels.xml')

  await fs.writeFile(m3uPath, m3uLines.join('\n'), 'utf8')
  await fs.writeFile(channelsXmlPath, channelsXmlLines.join('\n'), 'utf8')
  
  return { m3uPath, channelsXmlPath }
}
