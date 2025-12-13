import { execSync } from 'child_process'
import fs from 'fs-extra'
import { pathToFileURL } from 'node:url'

beforeEach(() => {
  fs.emptyDirSync('tests/__data__/output')
})

describe('m3u:parse', () => {
  it('can parse m3u file', () => {
    const cmd =
      'npm run m3u:parse --- --input=tests/__data__/input/m3u/test.m3u --output=tests/__data__/output/test.channels.xml'
    const stdout = execSync(cmd, { encoding: 'utf8' })
    if (process.env.DEBUG === 'true') console.log(cmd, stdout)

    expect(content('tests/__data__/output/test.channels.xml')).toEqual(
      content('tests/__data__/expected/m3u/test.channels.xml')
    )
  })
})

function content(filepath: string) {
  return fs.readFileSync(pathToFileURL(filepath), {
    encoding: 'utf8'
  })
}
