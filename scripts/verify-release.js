import fs from 'node:fs'

const tag = process.argv[2]
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const expected = `v${pkg.version}`
const expectedRepository = 'git+https://github.com/SwarmMachina/benchkit.git'

if (tag !== expected) {
  console.error(`release tag ${tag || '<missing>'} does not match package version ${expected}`)
  process.exitCode = 1
}

if (pkg.publishConfig?.provenance !== true) {
  console.error('publishConfig.provenance must be true')
  process.exitCode = 1
}

if (pkg.repository?.url !== expectedRepository) {
  console.error(`repository URL must be ${expectedRepository} for npm provenance`)
  process.exitCode = 1
}
