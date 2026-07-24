import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const supportedScopes = new Set(['unit', 'integration'])
const requestedScopes = process.argv.slice(2)
const scopes = requestedScopes.length > 0 ? requestedScopes : [...supportedScopes]

for (const scope of scopes) {
  if (!supportedScopes.has(scope)) {
    throw new TypeError(`unknown test scope: ${scope}`)
  }
}

const files = scopes.flatMap((scope) => collectTestFiles(path.join(root, 'tests', scope)).toSorted())

if (files.length === 0) {
  throw new Error(`no test files found for: ${scopes.join(', ')}`)
}

console.log(`running ${files.length} test files (${scopes.join(', ')})`)

const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-concurrency=1', ...files], {
  cwd: root,
  stdio: 'inherit'
})

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)

/**
 * Recursively discovers TypeScript test files below one scope directory.
 * @param {string} directory Directory to inspect.
 * @returns {string[]} Absolute test file paths.
 */
function collectTestFiles(directory) {
  const files = []

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...collectTestFiles(target))
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(target)
    }
  }

  return files
}
