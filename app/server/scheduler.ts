
import schedule from 'node-schedule'
import { GrabberEngine } from './grabber/engine'
import fs from 'fs-extra'
import path from 'path'
import { info, warn, error } from './log'
import { saveSelection } from './channels'

export class Scheduler {
    private engine: GrabberEngine
    private job: schedule.Job | null = null
    
    constructor(engine: GrabberEngine) {
        this.engine = engine
    }

    start() {
        // Run once on startup (next tick to allow server to start)
        setTimeout(() => this.runJob('startup'), 5000)

        // Schedule daily at midnight
        this.job = schedule.scheduleJob('0 0 * * *', () => {
            this.runJob('daily')
        })
        // Also run every 6 hours to keep files reasonably in sync
        schedule.scheduleJob('0 */6 * * *', () => { this.runJob('periodic') })
        info('[Scheduler] Initialized. Job scheduled for midnight.')
    }

    async runJob(context: 'startup' | 'daily' | 'manual') {
        const outDir = path.resolve(process.cwd(), 'output')
        const selectedIdsPath = path.join(outDir, 'selected_ids.json')
        
        let selectedIds: string[] = []
        try {
            if (await fs.pathExists(selectedIdsPath)) {
                selectedIds = await fs.readJson(selectedIdsPath)
            }
        } catch(e) { console.error('Failed to load selected IDs', e) }
        
        if (selectedIds.length === 0) {
            info('[Scheduler] No channels selected, skipping run.')
            return
        }

        try {
            await this.engine.run(selectedIds, { context })
            // After grabbing/parsing completes, regenerate M3U and channel XML to keep them in sync
            try {
                const outDir = path.resolve(process.cwd(), 'output')
                await saveSelection(selectedIds, outDir)
                info('[Scheduler] Regenerated selection M3U and channels XML')
            } catch (e) {
                error('[Scheduler] Failed to regenerate selection outputs', e)
            }
        } catch (e) {
            error('[Scheduler] Engine run failed:', e)
        }
    }
    
    stop() {
        if(this.job) {
            this.job.cancel()
            this.job = null
        }
    }
}
