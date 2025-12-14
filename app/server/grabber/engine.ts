
import fs from 'fs-extra'
import path from 'path'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
// @ts-ignore
import { EPGGrabber, EPGGrabberMock } from 'epg-grabber'
import axios from 'axios'
import { loadChannels } from '../channels'
import { getQueue } from './queue'
import { ChannelItem } from '../channels'
// @ts-ignore
import { Logger, Collection } from '@freearhey/core'
import { Channel, Program } from '../../../scripts/models'
import { SITES_DIR, DATA_DIR } from '../../../scripts/constants'
// @ts-ignore
import { loadJs } from '../../../scripts/core'
import merge from 'lodash.merge'
import { info, warn, error, debug } from '../log'
import EventEmitter from 'events'

dayjs.extend(utc)

const LOG_FILE = path.resolve(process.cwd(), 'output', 'grabber.log.json')

export class GrabberEngine {
    public emitter: EventEmitter = new EventEmitter()
    private isRunning = false
    private errors: any[] = []
    private activeJobs: Array<{ channel: string; site: string; date: string; status: 'queued' | 'running' | 'done' | 'failed' }> = []
    private lastRun: { startedAt: string | null; finishedAt: string | null; successful: number; failed: number } = { startedAt: null, finishedAt: null, successful: 0, failed: 0 }
    
    constructor() {}

    async run(selectedIds: string[], options: { context?: 'manual' | 'scheduled' } = {}) {
        if (this.isRunning) {
            throw new Error('Grabber is already running')
        }
        this.isRunning = true
        this.errors = []
        this.activeJobs = []
        this.lastRun.startedAt = new Date().toISOString()
        this.lastRun.finishedAt = null
        this.lastRun.successful = 0
        this.lastRun.failed = 0
        
        info(`[Grabber] Starting ${options.context} run for ${selectedIds.length} channels...`)

        try {
            this.emitter.emit('run:start', { context: options.context, total: selectedIds.length })
            const allChannels = await loadChannels()
            const targets = allChannels.filter(c => selectedIds.includes(c.xmltvId))
            if (!targets.length) {
                console.log('[Grabber] No channels selected to grab.')
                this.emitter.emit('run:empty')
                return
            }

            // Group by site to optimize queuing
            const bySite = new Map<string, ChannelItem[]>()
            for (const ch of targets) {
                if (!ch.site) continue
                if (!bySite.has(ch.site)) bySite.set(ch.site, [])
                bySite.get(ch.site)!.push(ch)
            }

            const promises: Promise<any>[] = []

            for (const [site, channels] of bySite.entries()) {
                const queue = getQueue(site)
                
                // Resolve site config path: prefer .mjs -> .cjs -> .js
                const base = path.resolve(SITES_DIR, site, site)
                const candidates = [base + '.config.mjs', base + '.config.cjs', base + '.config.js']
                let configPath = ''
                for (const c of candidates) {
                    if (await fs.pathExists(c)) {
                        configPath = c
                        break
                    }
                }

                let siteConfig: any = {}
                try {
                    if (configPath) {
                        siteConfig = await loadJs(configPath)
                    }
                } catch (e) {
                    console.warn(`Failed to load config for ${site}: ${e && e.message ? e.message : e}`)
                }
                
                const grabber = new EPGGrabber({ ...siteConfig })
                
                // Schedule requests for each channel
                for (const ch of channels) {
                    if(!ch.site_id) continue
                    
                    // Create minimal Channel object expected by grabber
                    // We need to map our ChannelItem to the epg-grabber Channel class or shape
                    const channelObj = new Channel({
                        site: ch.site,
                        site_id: ch.site_id,
                        xmltv_id: ch.xmltvId,
                        name: ch.name,
                        lang: ch.lang,
                        logo: ch.logo
                    })
                    
                    // Determine days to grab
                    const days = (siteConfig as any).days || 1
                    const currDate = dayjs.utc().startOf('day')
                    
                    for(let i=0; i<days; i++) {
                        const date = currDate.add(i, 'day')

                        // create job descriptor and push as queued
                        const dateStr = date.format('YYYY-MM-DD')
                        const jobDescriptor = { channel: ch.name, site: ch.site || '', date: dateStr, status: 'queued' as const }
                            this.activeJobs.push(jobDescriptor)
                            this.emitter.emit('job:update', { job: jobDescriptor, activeJobs: this.activeJobs.slice() })

                        // Before scheduling an expensive grab, probe the constructed URL(s) to avoid wasted requests
                        let probePassed = false
                        const probeResult: any[] = []
                        try {
                            // siteConfig.url can be a function or string or array
                            const urls: string[] = []
                            try {
                                const u = (siteConfig && typeof (siteConfig as any).url === 'function')
                                    ? (siteConfig as any).url({ date, channel: channelObj })
                                    : (siteConfig as any).url
                                if (!u) {
                                    // nothing to probe
                                } else if (Array.isArray(u)) urls.push(...u)
                                else urls.push(String(u))
                            } catch (e) {
                                // if building URL failed, record and skip
                                probeResult.push({ url: null, ok: false, error: String(e) })
                            }

                            for (const url of urls) {
                                if (!url) continue
                                try {
                                    // Try HEAD first with short timeout
                                    const headResp = await axios.head(url, { timeout: 5000 })
                                    probeResult.push({ url, status: headResp.status, ok: headResp.status >= 200 && headResp.status < 400 })
                                    if (headResp.status >= 200 && headResp.status < 400) {
                                        probePassed = true
                                        break
                                    }
                                } catch (headErr) {
                                    // If HEAD fails with 405 or similar, try GET with tiny range/timeout
                                    try {
                                        const getResp = await axios.get(url, { timeout: 5000, responseType: 'arraybuffer' })
                                        probeResult.push({ url, status: getResp.status, ok: getResp.status >= 200 && getResp.status < 400 })
                                        if (getResp.status >= 200 && getResp.status < 400) {
                                            probePassed = true
                                            break
                                        }
                                    } catch (getErr) {
                                        const status = getErr && getErr.response && getErr.response.status ? getErr.response.status : null
                                        probeResult.push({ url, ok: false, status, error: String(getErr && getErr.message ? getErr.message : getErr) })
                                    }
                                }
                            }
                        } catch (probeErr) {
                            probeResult.push({ url: null, ok: false, error: String(probeErr) })
                        }

                        // If probe didn't find any reachable URL, mark as unavailable and skip scheduling
                        if (!probePassed) {
                            jobDescriptor.status = 'unavailable'
                            this.emitter.emit('job:update', { job: jobDescriptor, activeJobs: this.activeJobs.slice(), probe: probeResult })
                            this.reportError(ch, date, new Error('No available URL (probe failed)'))
                            continue
                        }

                        promises.push(queue.schedule(async () => {
                            // update to running
                            jobDescriptor.status = 'running'
                            try {
                                debug(`[Grabber] Fetching ${ch.name} (${ch.site}) for ${dateStr}`)
                                const programs = await grabber.grab(channelObj, date, siteConfig, (ctx: any, err: any) => {
                                    if(err) {
                                        this.reportError(ch, date, err)
                                    }
                                })
                                jobDescriptor.status = 'done'
                                this.emitter.emit('job:update', { job: jobDescriptor, activeJobs: this.activeJobs.slice() })
                                return { channel: channelObj, programs, date }
                            } catch (error) {
                                jobDescriptor.status = 'failed'
                                this.emitter.emit('job:update', { job: jobDescriptor, activeJobs: this.activeJobs.slice() })
                                this.reportError(ch, date, error)
                                return null
                            }
                        }))
                    }
                }
            }

            const results = await Promise.all(promises)
            // write detailed probe/failure report
            try {
                const reportPath = path.resolve(process.cwd(), 'output', `grab-failures-${Date.now()}.json`)
                await fs.writeJson(reportPath, { errors: this.errors }, { spaces: 2 })
                debug(`[Grabber] Wrote failure report to ${reportPath}`)
            } catch (werr) {
                warn(`[Grabber] Failed to write failure report: ${werr}`)
            }
            const successful = results.filter(r => r !== null)

            await this.generateOutput(successful)
            await this.saveErrors()

            this.lastRun.finishedAt = new Date().toISOString()
            this.lastRun.successful = successful.length
            this.lastRun.failed = this.errors.length

            this.emitter.emit('run:done', { successful: successful.length, failed: this.errors.length })
            info(`[Grabber] Finished. ${successful.length} successful grabs. ${this.errors.length} errors.`)

        } catch (fatal) {
            error('[Grabber] Fatal error:', fatal)
            this.emitter.emit('run:error', { error: String(fatal) })
        } finally {
            this.isRunning = false
        }
    }
    
    private reportError(channel: ChannelItem, date: any, error: any) {
        error(`[Grabber] Error for ${channel.name}: ${error.message || error}`)
        this.errors.push({
            channel: channel.name,
            site: channel.site,
            date: date.format('YYYY-MM-DD'),
            error: error.message || String(error),
            timestamp: new Date().toISOString()
        })
        this.emitter.emit('error', { channel: channel.name, date: date.format('YYYY-MM-DD'), error: error.message || String(error) })
    }

    private async generateOutput(results: any[]) {
        const programs: Program[] = []
        const channelsMap = new Map<string, Channel>()
        
        for(const res of results) {
            if(!res) continue
            // Deduplicate programs?
            // epg-grabber returns raw objects, we might need to normalize
             const progs = res.programs.map((p: any) => new Program(p.toObject ? p.toObject() : p))
             programs.push(...progs)
             
             if(!channelsMap.has(res.channel.xmltv_id)) {
                 channelsMap.set(res.channel.xmltv_id, res.channel)
             }
        }
        
        const sortedChannels = Array.from(channelsMap.values()).sort((a,b) => a.xmltv_id.localeCompare(b.xmltv_id))
        
        const xml = EPGGrabber.generateXMLTV(sortedChannels, programs, dayjs.utc())
        const outDir = path.resolve(process.cwd(), 'output')
        await fs.ensureDir(outDir)
        await fs.writeFile(path.join(outDir, 'guide.xml'), xml)
        
        // Also save as JSON for debugging/web UI?
        // await fs.writeJson(path.join(outDir, 'guide.json'), programs)
    }
    
    private async saveErrors() {
        if(this.errors.length) {
            await fs.ensureDir(path.dirname(LOG_FILE))
            let existing: any[] = []
            try { existing = await fs.readJson(LOG_FILE) } catch(e) {}
            // Keep last 1000 errors
            const combined = [...existing, ...this.errors].slice(-1000)
            await fs.writeJson(LOG_FILE, combined, { spaces: 2 })
        }
    }
    
    public getStatus() {
        return {
            running: this.isRunning,
            errorCount: this.errors.length,
            activeJobs: this.activeJobs,
            lastRun: this.lastRun
        }
    }
}
