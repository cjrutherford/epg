import fs from 'fs-extra'
import path from 'path'

const OUT = path.resolve(process.cwd(), 'output')
const LOG_FILE = path.join(OUT, 'grabber.log.txt')

const LEVELS: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 }
const CURRENT = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? 2

async function appendLine(line: string) {
  try {
    await fs.ensureDir(OUT)
    await fs.appendFile(LOG_FILE, line + '\n', 'utf8')
  } catch (e) {
    // ignore file write errors to avoid noisy failures
  }
}

function formatMessage(level: string, args: any[]) {
  const ts = new Date().toISOString()
  const body = args.map(a => {
    if (typeof a === 'string') return a
    try { return JSON.stringify(a) } catch { return String(a) }
  }).join(' ')
  return `${ts} [${level.toUpperCase()}] ${body}`
}

export function info(...args: any[]) {
  const msg = formatMessage('info', args)
  if (CURRENT >= LEVELS['info']) console.log(msg)
  appendLine(msg)
}

export function warn(...args: any[]) {
  const msg = formatMessage('warn', args)
  if (CURRENT >= LEVELS['warn']) console.warn(msg)
  appendLine(msg)
}

export function error(...args: any[]) {
  const msg = formatMessage('error', args)
  if (CURRENT >= LEVELS['error']) console.error(msg)
  appendLine(msg)
}

export function debug(...args: any[]) {
  const msg = formatMessage('debug', args)
  if (CURRENT >= LEVELS['debug']) console.debug(msg)
  // keep debug out of the file by default to reduce noise; only append if LOG_LEVEL=debug
  if (CURRENT >= LEVELS['debug']) appendLine(msg)
}

export default { info, warn, error, debug }
