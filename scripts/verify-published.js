import fs from 'node:fs'

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const name = process.argv[2] || pkg.name
const version = process.argv[3] || pkg.version
const attempts = 12
const retryDelayMs = 5_000
const expectedPredicateType = 'https://slsa.dev/provenance/v1'
const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`

let lastError

for (let attempt = 1; attempt <= attempts; attempt++) {
  try {
    const response = await fetch(registryUrl)

    if (!response.ok) {
      throw new Error(`registry returned HTTP ${response.status}`)
    }

    const metadata = await response.json()
    const predicateType = metadata.dist?.attestations?.provenance?.predicateType

    if (predicateType !== expectedPredicateType) {
      throw new Error(
        `expected provenance predicate ${expectedPredicateType}, received ${predicateType || '<missing>'}`
      )
    }

    console.log(`verified npm provenance for ${name}@${version}`)
    process.exit(0)
  } catch (error) {
    lastError = error

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    }
  }
}

throw new Error(`npm provenance verification failed for ${name}@${version}`, { cause: lastError })
