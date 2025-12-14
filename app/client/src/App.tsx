
import React, { useState, useEffect } from 'react'
import FilterBar from './components/FilterBar'

type Channel = {
  xmltvId: string
  name: string
  site: string
  country: string
  logo?: string
  lang?: string
}

type Status = {
  running: boolean
  errorCount: number
}

function App() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'channels' | 'status'>('channels')
  const [status, setStatus] = useState<Status>({ running: false, errorCount: 0 })
  const [savedSelection, setSavedSelection] = useState<string[]>([])
  const [savedSelectionChannels, setSavedSelectionChannels] = useState<Channel[]>([])
  const [m3uUrl, setM3uUrl] = useState<string | null>(null)
  const [channelsXmlUrl, setChannelsXmlUrl] = useState<string | null>(null)
  const [jobs, setJobs] = useState<any>({ status: null, queueStats: {} })
  const [filterLang, setFilterLang] = useState<string>('')
  const [filterCountry, setFilterCountry] = useState<string>('')
  const [filterCountryOnly, setFilterCountryOnly] = useState<boolean>(false)
  const [filterArea, setFilterArea] = useState<string>('')
  const [filterTopic, setFilterTopic] = useState<string>('')
  const [langOptions, setLangOptions] = useState<string[]>([])
  const [countryOptions, setCountryOptions] = useState<string[]>([])
  const [areaOptions, setAreaOptions] = useState<string[]>([])
  const [topicOptions, setTopicOptions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [availableCount, setAvailableCount] = useState<number | null>(null)

  useEffect(() => {
    fetchStatus()
    fetchSelection()
    fetchJobs()
    fetchFilterOptions()
    const interval = setInterval(() => { fetchStatus(); fetchJobs() }, 5000)
    return () => clearInterval(interval)
  }, [])

  const fetchFilterOptions = async () => {
    try {
      const res = await fetch('/api/channels/filters')
      if (!res.ok) return
      const data = await res.json()
      if (data.langs) setLangOptions(data.langs)
      if (data.countries) setCountryOptions(data.countries)
      if (data.areas) setAreaOptions(data.areas)
      if (data.topics) setTopicOptions(data.topics)
    } catch (e) {
      // ignore; fall back to building options from search results
    }
  }

  useEffect(() => {
    // Run search whenever any filter or the query changes
    searchChannels()
  }, [query, filterCountryOnly, filterLang, filterCountry, filterArea, filterTopic])

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status')
      const data = await res.json()
      setStatus(data)
    } catch (e) { console.error(e) }
  }

  const fetchSelection = async () => {
    try {
      const res = await fetch('/api/selection')
      const data = await res.json()
      const ids = data.ids || []
      setSavedSelection(ids)
      setM3uUrl(data.m3uUrl || null)
      setChannelsXmlUrl(data.channelsXmlUrl || null)
      if (Array.isArray(data.channels)) setSavedSelectionChannels(data.channels)
      // Auto-load persisted selection into UI
      setSelected(new Set(ids))
    } catch (e) { console.error(e) }
  }

  const fetchJobs = async () => {
    try {
      const res = await fetch('/api/jobs')
      const data = await res.json()
      setJobs(data)
    } catch (e) { console.error(e) }
  }

  // Listen for server-sent events from the grabber engine for live updates
  useEffect(() => {
    let es: EventSource | null = null
    try {
      es = new EventSource('/api/events')
      es.addEventListener('job:update', (ev: any) => {
        try {
          const payload = JSON.parse(ev.data)
          setJobs(prev => ({ ...prev, status: { ...(prev.status || {}), activeJobs: payload.activeJobs } }))
          // update status.running if needed
        } catch (e) { /* ignore parse errors */ }
      })
      es.addEventListener('run:start', (ev: any) => {
        try { const p = JSON.parse(ev.data); setStatus(s => ({ ...s, running: true })) } catch (e) {}
      })
      es.addEventListener('run:done', (ev: any) => {
        try { const p = JSON.parse(ev.data); setStatus(s => ({ ...s, running: false })) } catch (e) {}
      })
      es.addEventListener('error', (ev: any) => {
        // engine-level error reported
        try { const p = JSON.parse(ev.data); console.error('Engine error', p); } catch (e) {}
      })
    } catch (e) {
      // EventSource unsupported or failed — fall back to polling (already in place)
    }
    return () => { if (es) es.close() }
  }, [])

  const searchChannels = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('q', query)
      if (filterCountryOnly) params.set('countryOnly', 'true')
      if (filterLang) params.set('lang', filterLang)
      if (filterCountry) params.set('country', filterCountry)
      if (filterArea) params.set('area', filterArea)
      if (filterTopic) params.set('topic', filterTopic)
      const res = await fetch(`/api/channels?${params.toString()}`)
      const data = await res.json()
      setChannels(data)

      // Build options from returned channels (best-effort)
      const langs = new Set<string>()
      const countries = new Set<string>()
      const areas = new Set<string>()
      const topics = new Set<string>()
      for (const ch of data) {
        if (ch.lang) langs.add(ch.lang)
        if (ch.country) countries.add(ch.country)
        const area = (ch as any).area || (ch as any).broadcast_area
        if (area) areas.add(area)
        const t = (ch as any).topic || (ch as any).topics
        if (Array.isArray(t)) for (const tt of t) topics.add(tt)
        else if (t) topics.add(t)
      }
      setLangOptions(Array.from(langs).sort())
      setCountryOptions(Array.from(countries).sort())
      setAreaOptions(Array.from(areas).sort())
      setTopicOptions(Array.from(topics).sort())
      // fetch available count for current filters
      try {
        const countRes = await fetch(`/api/channels/count?${params.toString()}`)
        if (countRes.ok) {
          const cd = await countRes.json()
          setAvailableCount(typeof cd.count === 'number' ? cd.count : null)
        } else setAvailableCount(null)
      } catch (e) { setAvailableCount(null) }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const toggleSelection = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const saveSelection = async () => {
    try {
      const res = await fetch('/api/channels/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) })
      })
      const data = await res.json()
      // update links and saved ids
      if (data && data.ids) setSavedSelection(data.ids)
      if (data && data.m3uUrl) setM3uUrl(data.m3uUrl)
      if (data && data.channelsXmlUrl) setChannelsXmlUrl(data.channelsXmlUrl)
      // also refresh server-side file
      fetchSelection()
      alert('Saved! Generated files available in output')
    } catch (e) {
      alert('Failed to save')
    }
  }

  const copyToClipboard = async (text?: string | null) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(window.location.origin + text)
      alert('Copied to clipboard')
    } catch (e) {
      console.error(e)
      alert('Failed to copy')
    }
  }
  
  const triggerGrab = async () => {
      try {
          await fetch('/api/grab', { method: 'POST' })
          fetchStatus()
      } catch(e) { alert('Failed to trigger grab') }
  }

  const triggerLoad = async () => {
    try {
      await fetch('/api/load', { method: 'POST' })
      // give the load some time, then refresh channels and selection
      setTimeout(() => { searchChannels(); fetchSelection() }, 2000)
      alert('Load started')
    } catch (e) { alert('Failed to start load') }
  }
  return (
    <div className="container">
      <header className="header">
        <h1>EPG Manager</h1>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <nav style={{ display: 'flex', gap: '0.5rem' }}>
              <button className={`btn ${view === 'channels' ? 'active' : ''}`} onClick={() => setView('channels')}>Channels</button>
              <button className={`btn ${view === 'status' ? 'active' : ''}`} onClick={() => setView('status')}>Status</button>
            </nav>

            <span style={{ flex: 1 }} />

            <span className={`status-badge ${status.running ? 'status-running' : 'status-idle'}`}>
                {status.running ? 'Grabbing...' : 'Idle'}
            </span>
             {status.errorCount > 0 && <span className="status-badge status-error">{status.errorCount} Errors</span>}
             <button className="btn" onClick={triggerGrab} disabled={status.running}>Grab Now</button>
             <button className="btn" onClick={triggerLoad}>Load</button>
             <button className="btn" onClick={saveSelection}>Save Selection ({selected.size})</button>
        </div>
      </header>

      {view === 'channels' && (
        <>
            <div style={{ display: 'flex', gap: '1rem', margin: '0.5rem 0', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 8 }}>
                  <input
                    className="search-bar"
                    type="text"
                    placeholder="Search channels (name, site, id)..."
                    value={query}
                    onChange={(e) => { setQuery(e.target.value) }}
                    style={{ width: '100%', padding: '8px' }}
                  />
                </div>
                <FilterBar
                  query={query}
                  onQueryChange={(q) => { setQuery(q) }}
                  lang={filterLang}
                  onLangChange={(l) => { setFilterLang(l) }}
                  country={filterCountry}
                  onCountryChange={(c) => { setFilterCountry(c) }}
                  area={filterArea}
                  onAreaChange={(a) => { setFilterArea(a) }}
                  topic={filterTopic}
                  onTopicChange={(t) => { setFilterTopic(t) }}
                  countryOnly={filterCountryOnly}
                  onCountryOnlyChange={(v) => { setFilterCountryOnly(v) }}
                  langOptions={langOptions}
                  countryOptions={countryOptions}
                  areaOptions={areaOptions}
                  topicOptions={topicOptions}
                />
              </div>

              <div style={{ width: 260, borderLeft: '1px solid #e6eef8', paddingLeft: '1rem' }}>
                <h3>Saved Selection ({savedSelection.length})</h3>
                <div style={{ marginTop: 6, marginBottom: 6 }}>
                  <button className="btn" onClick={() => {
                    // select visible
                    const ids = channels.map(c => c.xmltvId)
                    setSelected(prev => {
                      const next = new Set(prev)
                      for (const id of ids) next.add(id)
                      return next
                    })
                  }}>Select Visible ({channels.length})</button>
                  {' '}
                  <button className="btn" onClick={async () => {
                    // select all available
                    try {
                      const params = new URLSearchParams()
                      params.set('q', query)
                      if (filterCountryOnly) params.set('countryOnly', 'true')
                      if (filterLang) params.set('lang', filterLang)
                      if (filterCountry) params.set('country', filterCountry)
                      if (filterArea) params.set('area', filterArea)
                      if (filterTopic) params.set('topic', filterTopic)
                      const res = await fetch(`/api/channels/ids?${params.toString()}`)
                      if (!res.ok) throw new Error('failed')
                      const ids: string[] = await res.json()
                      setSelected(prev => {
                        const next = new Set(prev)
                        for (const id of ids) next.add(id)
                        return next
                      })
                    } catch (e) { alert('Failed to select all') }
                  }}>Select All{availableCount ? ` (${availableCount})` : ''}</button>
                  {' '}
                  <button className="btn" onClick={() => setSelected(new Set())}>Clear Selection</button>
                </div>
                <div style={{ maxHeight: 200, overflow: 'auto' }}>
                  {savedSelectionChannels.length === 0 ? (
                    <div style={{ color: '#64748b' }}>No saved selection</div>
                  ) : (
                    <div>
                      {savedSelectionChannels.map(ch => (
                        <div key={ch.xmltvId} style={{ fontSize: 13 }}>{ch.name} <span style={{ color: '#64748b' }}>({ch.xmltvId})</span></div>
                      ))}
                      <div style={{ marginTop: 8 }}>
                        {m3uUrl ? (
                          <div style={{ fontSize: 13 }}>
                            <a href={m3uUrl} target="_blank" rel="noreferrer">Open M3U</a>
                            {' '}
                            <button className="btn" style={{ marginLeft: 6 }} onClick={() => copyToClipboard(m3uUrl)}>Copy M3U URL</button>
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: '#94a3b8' }}>No M3U generated</div>
                        )}
                        {channelsXmlUrl ? (
                          <div style={{ fontSize: 13, marginTop: 6 }}>
                            <a href={channelsXmlUrl} target="_blank" rel="noreferrer">Open XMLTV</a>
                            {' '}
                            <button className="btn" style={{ marginLeft: 6 }} onClick={() => copyToClipboard(channelsXmlUrl)}>Copy XMLTV URL</button>
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>No XMLTV generated</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ width: 260, marginLeft: 12 }}>
                <h4>Active Jobs</h4>
                <div style={{ maxHeight: 120, overflow: 'auto', fontSize: 13 }}>
                  {jobs && jobs.status && jobs.status.activeJobs && jobs.status.activeJobs.length ? (
                    jobs.status.activeJobs.slice(0,10).map((j: any, idx: number) => (
                      <div key={idx}>{j.channel} — {j.date} <em>({j.status})</em></div>
                    ))
                  ) : (
                    <div style={{ color: '#64748b' }}>No active jobs</div>
                  )}
                </div>
              </div>
            </div>

          {loading ? (
            <div>Loading...</div>
          ) : (
            <div className="channel-grid">
              {channels.map((ch) => (
                <div
                  key={ch.xmltvId}
                  className={`channel-card ${selected.has(ch.xmltvId) ? 'selected' : ''}`}
                  onClick={() => toggleSelection(ch.xmltvId)}
                >
                  <img
                    src={ch.logo || 'https://via.placeholder.com/48'}
                    alt=""
                    className="channel-logo"
                    onError={(e) => (e.currentTarget.style.display = 'none')}
                  />
                  <div className="channel-info">
                    <div className="channel-name">{ch.name}</div>
                    <div className="channel-meta">
                      {ch.site} • {ch.country}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && channels.length === 0 && (
              <div style={{ textAlign: 'center', color: '#64748b' }}>No channels found</div>
          )}
        </>
      )}

      {view === 'status' && (
        <div style={{ marginTop: '1rem' }}>
          <h2>System Status</h2>
          <div>Running: {status.running ? 'Yes' : 'No'}</div>
          <div>Errors: {status.errorCount}</div>
          <h3 style={{ marginTop: '1rem' }}>Active Jobs</h3>
          <div style={{ maxHeight: 400, overflow: 'auto' }}>
            {jobs && jobs.status && jobs.status.activeJobs && jobs.status.activeJobs.length ? (
              jobs.status.activeJobs.map((j: any, idx: number) => (
                <div key={idx} style={{ fontSize: 13 }}>
                  <strong>{j.channel}</strong> — {j.date} <em>({j.status})</em>
                </div>
              ))
            ) : (
              <div style={{ color: '#64748b' }}>No active jobs</div>
            )}
          </div>
        </div>
      )}
      </div>
    );
}

export default App;
