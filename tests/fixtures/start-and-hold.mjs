import fs from 'node:fs/promises'
import { createTargetProvider } from '../../dist/index.js'

const cwd = new URL('../../', import.meta.url)
const pidFile = process.argv[2]
const provider = createTargetProvider({
  mode: 'local',
  cwd: cwd.pathname,
  timeouts: {
    targetReadyMs: 5_000,
    shutdownGraceMs: 200,
    killMs: 200
  }
})
const session = await provider.start({
  entrypoint: './tests/fixtures/target.mjs',
  args: ['--log-interval'],
  env: {
    BENCHKIT_FIXTURE_PID_FILE: pidFile
  }
})

await session.waitReachable()
const targetPid = Number(await fs.readFile(pidFile, 'utf8'))

process.stdout.write(`READY ${targetPid}\n`)
setInterval(() => {}, 10_000)
