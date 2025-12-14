
import React, { useState, useEffect } from 'react' // eslint-disable-line no-unused-vars
import { Box, Text, useInput } from 'ink' // eslint-disable-line no-unused-vars
import TextInput from 'ink-text-input' // eslint-disable-line no-unused-vars
import Spinner from 'ink-spinner' // eslint-disable-line no-unused-vars
import fs from 'fs-extra'
import path from 'path'
import { DATA_DIR } from '../../scripts/constants'
import EventSourceClient from 'eventsource'


type ChannelItem = {
    xmltvId: string
    name: string
    site?: string
    site_id?: string
    logo?: string
    country?: string
    lang?: string
}

const escapeXml = (str?: string) =>
    String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')

const ChannelList = () => {
    const [query, setQuery] = useState('')
    const [channels, setChannels] = useState<ChannelItem[]>([])
    const [loading, setLoading] = useState(false)
    const [cursor, setCursor] = useState(0)
    const [selected, setSelected] = useState(new Map<string, ChannelItem>())
    // modes: 'search' — typing a query; 'list' — navigate results; 'generate' — output prompt; 'message' — transient message
    const [mode, setMode] = useState<'search' | 'list' | 'generate' | 'message' | 'jobs'>('search')
    const [outDir, setOutDir] = useState(path.resolve(process.cwd(), 'output'))
    const [message, setMessage] = useState('')
    const [jobsData, setJobsData] = useState<any>(null)

    useEffect(() => {
        // Load channels and supporting data from DATA_DIR
        let mounted = true
        const load = async () => {
            setLoading(true)
            try {
                const channelsPath = path.resolve(DATA_DIR, 'channels.json')
                const feedsPath = path.resolve(DATA_DIR, 'feeds.json')
                const streamsPath = path.resolve(DATA_DIR, 'streams.json')
                const guidesPath = path.resolve(DATA_DIR, 'guides.json')

                let channelsRaw: any = []
                try { channelsRaw = await fs.readJson(channelsPath) } catch (e) { channelsRaw = [] }
                let feedsRaw: any = []
                try { feedsRaw = await fs.readJson(feedsPath) } catch (e) { feedsRaw = [] }
                let streamsRaw: any = []
                try { streamsRaw = await fs.readJson(streamsPath) } catch (e) { streamsRaw = [] }
                let guidesRaw: any = []
                try { guidesRaw = await fs.readJson(guidesPath) } catch (e) { guidesRaw = [] }

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

                const guidesByChannel = new Map<string, any>()
                if (Array.isArray(guidesRaw)) {
                    for (const g of guidesRaw) if (g && g.channel) guidesByChannel.set(String(g.channel), g)
                }

                const out: ChannelItem[] = []
                const channelsMap: any = channelsRaw || []
                if (channelsMap && typeof channelsMap.all === 'function') {
                    for (const ch of channelsMap.all()) {
                        const id = ch.id || ch.xmltv_id || ch._id || ''
                        const feed = feedsByXmltv.get(String(id)) || feedsByChannel.get(String(id))
                        const inferredSite = ch.site || ch.site_name || ch.provider || (feed && (feed.site || feed.provider || feed.source)) || ''
                        const inferredSiteId = ch.site_id || ch.id || ch.channel_id || (feed && (feed.site_id || feed.id || feed.channel)) || ''
                        out.push({ xmltvId: String(id), name: ch.name || ch.title || String(id), site: inferredSite, site_id: inferredSiteId, logo: ch.logo || ch.image || ch.logo_url, country: ch.country || ch.country_code || ch.cc, lang: ch.lang || 'en' })
                    }
                } else if (typeof (channelsMap as Map<string, any>).entries === 'function') {
                    for (const [id, ch] of (channelsMap as Map<string, any>).entries()) {
                        out.push({ xmltvId: String(id), name: ch.name || ch.title || String(id), site: ch.site || ch.site_name || ch.provider, site_id: ch.site_id || ch.id || ch.channel_id, logo: ch.logo || ch.image || ch.logo_url, country: ch.country || ch.country_code || ch.cc, lang: ch.lang || 'en' })
                    }
                } else {
                    Object.entries(channelsMap || {}).forEach(([id, ch]: [string, any]) => {
                        out.push({ xmltvId: String(id), name: ch.name || ch.title || String(id), site: ch.site || ch.site_name || ch.provider, site_id: ch.site_id || ch.id || ch.channel_id, logo: ch.logo || ch.image || ch.logo_url, country: ch.country || ch.country_code || ch.cc, lang: ch.lang || 'en' })
                    })
                }

                // prefer guide-provided mappings
                for (const ch of out) {
                    const guide = guidesByChannel.get(String(ch.xmltvId))
                    if (guide) {
                        if (guide.site) ch.site = guide.site
                        if (guide.site_id) ch.site_id = guide.site_id
                    }
                }

                if (mounted) {
                    setChannels(out)
                    setCursor(0)
                }
            } catch (e) {
                // ignore
            } finally {
                if (mounted) setLoading(false)
            }
        }

        load()
        return () => { mounted = false }
    }, [])

    // Poll server for job status if available (fallback to frequent polling)
    useEffect(() => {
        let mounted = true
        let id: any = null
        let es: any = null
        const startPolling = () => {
            const poll = async () => {
                try {
                    const res = await fetch('http://localhost:3000/api/jobs')
                    if (!mounted) return
                    const data = await res.json()
                    setJobsData(data)
                } catch (e) {
                    // ignore
                }
            }
            poll()
            id = setInterval(poll, 2000)
        }

        // Prefer SSE if eventsource is available
        if (EventSourceClient) {
            try {
                es = new EventSourceClient('http://localhost:3000/api/events')
                es.addEventListener('job:update', (e: any) => {
                    try {
                        const payload = JSON.parse(e.data)
                        setJobsData({ status: { activeJobs: payload.activeJobs } })
                    } catch (err) {}
                })
                es.addEventListener('run:start', () => {
                    // may show a message
                })
                es.addEventListener('run:done', () => {
                    // done
                })
            } catch (err) {
                // fallback to polling
                startPolling()
            }
        } else {
            startPolling()
        }

        return () => {
            mounted = false
            if (id) clearInterval(id)
            if (es) es.close && es.close()
        }
    }, [])

    // filter locally
    const filtered = channels.filter(ch => {
        const q = query.trim().toLowerCase()
        if (!q) return true
        return (
            (ch.name || '').toLowerCase().includes(q) ||
            (ch.xmltvId || '').toLowerCase().includes(q) ||
            (ch.site || '').toLowerCase().includes(q) ||
            (ch.country || '').toLowerCase().includes(q)
        )
    })

    useInput((input, key) => {
        // Tab toggles between search and list modes
        if (key.tab) {
            setMode(prev => (prev === 'list' ? 'search' : 'list'))
            return
        }

        // When prompting for outDir we ignore navigation keys
        if (mode === 'generate') return

        // Only respond to navigation and selection keys while in 'list' mode
        if (mode !== 'list') return

        if (key.downArrow) setCursor(prev => Math.min(prev + 1, filtered.length - 1))
        if (key.upArrow) setCursor(prev => Math.max(prev - 1, 0))

        if (input === ' ') {
            const ch = filtered[cursor]
            if (!ch) return
            setSelected(prev => {
                const copy = new Map(prev)
                if (copy.has(ch.xmltvId)) copy.delete(ch.xmltvId)
                else copy.set(ch.xmltvId, ch)
                return copy
            })
        }

        if (input === 'a') {
            // toggle select all for currently filtered list
            const allIds = filtered.map(ch => ch.xmltvId)
            const anyUnselected = allIds.some(id => !selected.has(id))
            setSelected(prev => {
                if (anyUnselected) {
                    const copy = new Map(prev)
                    for (const ch of filtered) copy.set(ch.xmltvId, ch)
                    return copy
                }
                const copy = new Map(prev)
                for (const id of allIds) copy.delete(id)
                return copy
            })
        }

        if (input === 's') {
            // show selected summary
            const lines = Array.from(selected.values()).map(ch => `${ch.xmltvId} — ${ch.name}`)
            setMessage(`Selected: ${selected.size}\n${lines.slice(0, 100).join('\n')}`)
            setMode('message')
            setTimeout(() => setMode('list'), 3000)
        }

        if (input === 'j') {
            // toggle jobs view
            setMode(prev => (prev === 'jobs' ? 'list' : 'jobs'))
        }

        if (input === 'l') {
            // load saved selection from server (if available)
            ;(async () => {
                try {
                    const res = await fetch('http://localhost:3000/api/selection')
                    const data = await res.json()
                    const ids: string[] = data.ids || []
                    // build selected map from local channels list
                    const map = new Map<string, ChannelItem>()
                    for (const ch of channels) if (ids.includes(ch.xmltvId)) map.set(ch.xmltvId, ch)
                    setSelected(map)
                    setMessage(`Loaded ${map.size} saved channels from server`)
                    setMode('message')
                    setTimeout(() => setMode('list'), 2000)
                } catch (e) {
                    setMessage('Failed to load selection from server')
                    setMode('message')
                    setTimeout(() => setMode('list'), 2000)
                }
            })()
        }
        if (input === 'g') setMode('generate')
    })

    const onGenerate = async () => {
        if (!selected.size) {
            setMessage('No channels selected — nothing to generate.')
            setMode('message')
            setTimeout(() => setMode('browse'), 3000)
            return
        }

        try {
            await fs.ensureDir(outDir)
            const m3uLines: string[] = ['#EXTM3U']
            const channelsXmlLines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<channels>']

            // load feeds/streams/guides to enrich like the CLI script
            let feedsRaw: any = []
            let streamsRaw: any = []
            let guidesRaw: any = []
            try { feedsRaw = await fs.readJson(path.resolve(DATA_DIR, 'feeds.json')) } catch (e) { feedsRaw = [] }
            try { streamsRaw = await fs.readJson(path.resolve(DATA_DIR, 'streams.json')) } catch (e) { streamsRaw = [] }
            try { guidesRaw = await fs.readJson(path.resolve(DATA_DIR, 'guides.json')) } catch (e) { guidesRaw = [] }

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

            const guidesByChannel = new Map<string, any>()
            if (Array.isArray(guidesRaw)) for (const g of guidesRaw) if (g && g.channel) guidesByChannel.set(String(g.channel), g)

            for (const ch of selected.values()) {
                const safeLogo = ch.logo || ''
                const safeXmltv = ch.xmltvId || ''
                m3uLines.push(`#EXTINF:-1 tvg-id="${safeXmltv}" tvg-logo="${safeLogo}",${ch.name}`)
                const streamUrl = `http://STREAM_PLACEHOLDER/${safeXmltv}`
                m3uLines.push(streamUrl)

                let site = ch.site || ''
                let siteId = ch.site_id || ''
                const feedByXmltv = feedsByXmltv.get(String(safeXmltv))
                if (feedByXmltv) {
                    site = site || feedByXmltv.site || feedByXmltv.provider || feedByXmltv.source || ''
                    siteId = siteId || feedByXmltv.site_id || feedByXmltv.id || feedByXmltv.channel || ''
                }
                const feedByChannel = feedsByChannel.get(String(safeXmltv)) || feedsByChannel.get(String(siteId)) || feedsByChannel.get(String(ch.xmltvId))
                if (feedByChannel) {
                    site = site || feedByChannel.site || feedByChannel.provider || feedByChannel.source || ''
                    siteId = siteId || feedByChannel.site_id || feedByChannel.id || feedByChannel.channel || ''
                }
                if ((!site || !siteId) && Array.isArray(streamsRaw)) {
                    const streamMatch = (streamsRaw as any[]).find((s: any) => String(s.xmltv_id) === String(safeXmltv) || String(s.channel) === String(safeXmltv) || String(s.id) === String(safeXmltv))
                    if (streamMatch) {
                        site = site || streamMatch.site || streamMatch.provider || ''
                        siteId = siteId || streamMatch.site_id || streamMatch.id || streamMatch.channel || ''
                    }
                }
                const guide = guidesByChannel.get(String(safeXmltv))
                if (guide) {
                    site = site || guide.site || guide.site_name || ''
                    siteId = siteId || guide.site_id || guide.channel || ''
                }
                if (!siteId && site && site.includes('#')) {
                    const parts = site.split('#')
                    if (parts.length > 1) siteId = parts[1]
                }
                const lang = ch.lang || 'en'
                channelsXmlLines.push(`<channel site="${escapeXml(site)}" lang="${escapeXml(lang)}" xmltv_id="${escapeXml(safeXmltv)}" site_id="${escapeXml(siteId)}">${escapeXml(ch.name)}</channel>`)
            }

            channelsXmlLines.push('</channels>')

            const m3uPath = path.join(outDir, 'api.selected.channels.m3u')
            const channelsXmlPath = path.join(outDir, 'api.selected.channels.xml')
            await fs.writeFile(m3uPath, m3uLines.join('\n'), 'utf8')
            await fs.writeFile(channelsXmlPath, channelsXmlLines.join('\n'), 'utf8')

            setMessage(`Wrote M3U: ${m3uPath}\nWrote channels XML: ${channelsXmlPath}`)
            setMode('message')
            setTimeout(() => setMode('list'), 4000)
        } catch (e: any) {
            setMessage(`Failed to generate files: ${e.message || e}`)
            setMode('message')
            setTimeout(() => setMode('list'), 4000)
        }
    }

    return (
        <Box flexDirection="column">
            <Box>
                <Text>Search: </Text>
                {mode === 'search' ? (
                    <TextInput value={query} onChange={setQuery} onSubmit={() => setMode('list')} />
                ) : (
                    <Text color="gray">{query || '<empty>'}</Text>
                )}
            </Box>

            <Box flexDirection="column" marginTop={1}>
                {loading && <Text><Spinner /> Loading channels...</Text>}
                {mode === 'jobs' && jobsData && (
                    <Box flexDirection="column" marginBottom={1}>
                        <Text color="yellow">Active Jobs:</Text>
                        {jobsData.status && jobsData.status.activeJobs && jobsData.status.activeJobs.length ? (
                            jobsData.status.activeJobs.map((j: any, idx: number) => (
                                <Text key={idx}>{j.channel} — {j.date} ({j.status})</Text>
                            ))
                        ) : (
                            <Text color="gray">No active jobs</Text>
                        )}
                    </Box>
                )}
                {!loading && filtered.slice(0, 30).map((ch, i) => {
                    const isSelected = selected.has(ch.xmltvId)
                    const displayIndex = i
                    const isCursor = displayIndex === cursor
                    return (
                        <Text key={ch.xmltvId} color={isCursor ? 'blue' : isSelected ? 'green' : 'white'}>
                            {isCursor ? (mode === 'list' ? '> ' : '  ') : '  '}{isSelected ? '[x] ' : '[ ] '}{ch.name} {ch.country ? '[' + ch.country + ']' : ''} {ch.site ? '(' + ch.site + ')' : ''}
                        </Text>
                    )
                })}
                {!loading && filtered.length === 0 && <Text color="gray">No channels found</Text>}
            </Box>

            <Box marginTop={1} borderStyle="single" borderColor="gray">
                <Text wrap="truncate">Controls: Tab: toggle Search/List · Up/Down: navigate (list) · Space: toggle select · a: select all · s: show selected · g: generate · q: quit</Text>
            </Box>

            {mode === 'generate' && (
                <Box marginTop={1} flexDirection="column">
                    <Text>Output directory:</Text>
                    <TextInput value={outDir} onChange={setOutDir} onSubmit={() => { setMode('browse'); onGenerate() }} />
                </Box>
            )}

            {mode === 'message' && (
                <Box marginTop={1} paddingX={1} borderStyle="single">
                    <Text>{message}</Text>
                </Box>
            )}
        </Box>
    )
}

export default ChannelList
