import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

const root = new URL('../', import.meta.url)
const packageJson = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8'))

for (const name of ['check', 'test', 'test:packed-types']) {
  if (typeof packageJson.scripts[name] !== 'string') {
    throw new TypeError(`missing package script: ${name}`)
  }

  const result = spawnSync('pnpm', ['run', name], {
    cwd: root,
    stdio: 'inherit'
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
