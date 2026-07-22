import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

const root = new URL('../', import.meta.url)
const packageJson = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8'))

for (const name of ['check', 'test', 'build']) {
  const result = spawnSync(packageJson.scripts[name], {
    cwd: root,
    shell: true,
    stdio: 'inherit'
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
