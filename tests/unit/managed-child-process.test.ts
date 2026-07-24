import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { terminateChildProcess, terminateWindowsProcessTree, waitForChildExit } from '@swarmmachina/benchkit'

test('waitForChildExit returns null on timeout and removes listeners', async () => {
  const fake = child()

  assert.equal(await waitForChildExit(fake.process, 0), null)
  assert.equal(fake.events.listenerCount('exit'), 0)
  assert.equal(fake.events.listenerCount('error'), 0)
})

test('terminateChildProcess escalates and reports the terminal signal', async () => {
  const fake = child((signal) => {
    if (signal === 'SIGKILL') {
      setImmediate(() => fake.exit(null, signal))
    }
  })
  const result = await terminateChildProcess(fake.process, { graceMs: 0, killMs: 100 })

  assert.deepEqual(fake.signals, ['SIGTERM', 'SIGKILL'])
  assert.equal(result.escalated, true)
  assert.equal(result.exit.signal, 'SIGKILL')
})

test('terminateWindowsProcessTree invokes bounded taskkill', async () => {
  let invocation: unknown

  await terminateWindowsProcessTree(123, 250, (command, args, options, callback) => {
    invocation = { command, args, options }
    setImmediate(() => callback(null, '', ''))

    return {} as ReturnType<typeof import('node:child_process').execFile>
  })

  assert.deepEqual(invocation, {
    command: 'taskkill',
    args: ['/pid', '123', '/T', '/F'],
    options: { encoding: 'utf8', maxBuffer: 65_536, timeout: 250, windowsHide: true }
  })
})

function child(onKill: (signal: NodeJS.Signals) => void = () => {}): {
  events: EventEmitter
  process: ChildProcess
  signals: NodeJS.Signals[]
  exit: (code: number | null, signal: NodeJS.Signals | null) => void
} {
  const events = new EventEmitter() as EventEmitter & Partial<ChildProcess>
  const signals: NodeJS.Signals[] = []

  events.exitCode = null
  events.signalCode = null
  events.pid = 123
  events.kill = (signal = 'SIGTERM') => {
    signals.push(signal)
    onKill(signal)

    return true
  }
  const exit = (code: number | null, signal: NodeJS.Signals | null) => {
    events.exitCode = code
    events.signalCode = signal
    events.emit('exit', code, signal)
  }

  return { events, process: events as ChildProcess, signals, exit }
}
