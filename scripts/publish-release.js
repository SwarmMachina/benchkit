import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const expectedRef = `refs/tags/v${pkg.version}`
const expectedPredicateType = 'https://slsa.dev/provenance/v1'
const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`

if (process.env.GITHUB_ACTIONS !== 'true') {
  throw new Error('package publication is allowed only from GitHub Actions')
}

if (process.env.GITHUB_REF !== expectedRef) {
  throw new Error(`package publication requires ${expectedRef}`)
}

if (process.env.GITHUB_REPOSITORY !== 'SwarmMachina/benchkit') {
  throw new Error('package publication requires the SwarmMachina/benchkit repository')
}

const response = await fetch(registryUrl)

if (response.ok) {
  const metadata = await response.json()
  const predicateType = metadata.dist?.attestations?.provenance?.predicateType

  if (predicateType !== expectedPredicateType) {
    throw new Error(`${pkg.name}@${pkg.version} already exists without the required npm provenance`)
  }

  console.log(`${pkg.name}@${pkg.version} is already published with npm provenance`)
  process.exit(0)
}

if (response.status !== 404) {
  throw new Error(`cannot query npm registry: HTTP ${response.status}`)
}

const publish = spawnSync('npm', ['publish', '--provenance', '--access', 'public'], {
  env: { ...process.env, NPM_CONFIG_PROVENANCE: 'true' },
  stdio: 'inherit'
})

if (publish.error) {
  throw publish.error
}

if (publish.status !== 0) {
  process.exit(publish.status ?? 1)
}
