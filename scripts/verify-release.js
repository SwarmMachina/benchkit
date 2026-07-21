import fs from 'node:fs'

const tag = process.argv[2]
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const expected = `v${pkg.version}`

if (tag !== expected) {
  console.error(`release tag ${tag || '<missing>'} does not match package version ${expected}`)
  process.exitCode = 1
}
