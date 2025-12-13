import { execSync } from 'child_process'
import fs from 'fs-extra'
import { pathToFileURL } from 'node:url'

const ENV_VAR = 'cross-env DATA_DIR=tests/__data__/input/data'

beforeEach(() => {
  fs.emptyDirSync('tests/__data__/output')
})

describe('m3u:parse', () => {
  it('can parse m3u file and match channels with EPG sources', () => {
    const cmd =
      `${ENV_VAR} SITES_DIR=tests/__data__/input/epg_grab/sites npm run m3u:parse --- --input=tests/__data__/input/m3u/test.m3u --output=tests/__data__/output/test.channels.xml --enriched-m3u=tests/__data__/output/test.enriched.m3u`
    const stdout = execSync(cmd, { encoding: 'utf8' })
    if (process.env.DEBUG === 'true') console.log(cmd, stdout)

    // Check channels.xml output
    expect(content('tests/__data__/output/test.channels.xml')).toEqual(
      content('tests/__data__/expected/m3u/test.channels.xml')
    )
    
    // Check enriched M3U was created
    const enrichedContent = content('tests/__data__/output/test.enriched.m3u')
    expect(enrichedContent).toContain('#EXTM3U')
    expect(enrichedContent).toContain('tvg-id="CNNInternational.us"')
  })
})

function content(filepath: string) {
  return fs.readFileSync(pathToFileURL(filepath), {
    encoding: 'utf8'
  })
}
