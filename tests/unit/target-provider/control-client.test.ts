import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import test from 'node:test'
import { ControlClient } from '../../../dist/target-provider/control-client.js'

test('ControlClient.close force-kills an agent after its graceful deadline', { timeout: 2_000 }, async (t) => {
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      [
        "process.on('SIGTERM', () => {})",
        'process.stdin.resume()',
        'setInterval(() => {}, 1_000)',
        "process.stderr.write('ready\\n')"
      ].join(';')
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  )

  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
    }
  })

  const client = new ControlClient(child, 1_024)

  await once(child.stderr, 'data')
  await client.close(25)

  assert.equal(child.signalCode, 'SIGKILL')
})
