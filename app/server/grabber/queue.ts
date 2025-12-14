
import Bottleneck from 'bottleneck'

const queues = new Map<string, Bottleneck>()

// Default options: 1 request per 1000ms per domain
const DEFAULT_MIN_TIME = 1000
const DEFAULT_MAX_CONCURRENT = 1

export function getQueue(site: string): Bottleneck {
  if (!queues.has(site)) {
    // We could load custom config per site here if needed
    const limiter = new Bottleneck({
      minTime: DEFAULT_MIN_TIME,
      maxConcurrent: DEFAULT_MAX_CONCURRENT,
      id: site // useful for clustering if we ever did that
    })
    
    limiter.on('error', (error) => {
        console.error(`Queue error for ${site}:`, error)
    })
    
    queues.set(site, limiter)
  }
  return queues.get(site)!
}

export function getStats() {
    const stats: Record<string, any> = {}
    for(const [site, limiter] of queues.entries()) {
        stats[site] = limiter.counts()
    }
    return stats
}
