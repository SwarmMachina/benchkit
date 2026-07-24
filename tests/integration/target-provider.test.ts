import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  BENCHKIT_VERSION,
  PROTOCOL_VERSION,
  createTargetProvider,
  TargetUnreachableError,
  TimeoutError
} from '../../dist/index.js'

const root = path.resolve(new URL('../../', import.meta.url).pathname)

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = performance.now() + timeoutMs

  while (performance.now() < deadline) {
    if (await condition()) {
      return
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 50))
  }

  assert.fail(`condition did not become true after ${timeoutMs}ms`)
}

test('local stdio agent runs target readiness, metrics, and shutdown lifecycle', async () => {
  const provider = createTargetProvider({
    mode: 'local',
    cwd: root,
    timeouts: { shutdownGraceMs: 300, killMs: 300 }
  })
  const session = await provider.start({ entrypoint: './tests/fixtures/target.mjs' })

  assert.equal(session.state, 'ready')
  await session.waitReachable()
  await session.startMetrics({ sampleMs: 50 })
  assert.equal(session.state, 'measuring')
  await new Promise<void>((resolve) => setTimeout(resolve, 80))
  const metrics = await session.stopMetrics()

  assert.equal(session.state, 'ready')
  assert.ok(metrics.wallMs >= 1)
  assert.ok(metrics.cpuCorePct >= 0)
  assert.ok(metrics.memMB.rssPeak > 0)
  assert.equal(session.targetEnvironment.nodeVersion, process.version)

  await session.stop()
  assert.equal(session.state, 'stopped')
})

test('target readiness timeout cleans up a started fixture process', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'benchkit-timeout-'))
  const pidFile = path.join(directory, 'target.pid')
  const provider = createTargetProvider({
    mode: 'local',
    cwd: root,
    timeouts: {
      targetReadyMs: 100,
      shutdownGraceMs: 100,
      killMs: 100
    }
  })

  await assert.rejects(
    provider.start({
      entrypoint: './tests/fixtures/target.mjs',
      args: ['--ready-delay-ms', '10000'],
      env: { BENCHKIT_FIXTURE_PID_FILE: pidFile }
    }),
    TimeoutError
  )

  const pid = Number(await fs.readFile(pidFile, 'utf8'))

  await waitFor(() => !isAlive(pid))
})

test('startup failures expose bounded target diagnostics', async () => {
  const provider = createTargetProvider({ mode: 'local', cwd: root })

  await assert.rejects(
    provider.start({
      entrypoint: './tests/fixtures/target.mjs',
      args: ['--fail-before-ready']
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(
        String((error as Error & { details?: { diagnostics?: string } }).details?.diagnostics),
        /fixture startup failure/u
      )

      return true
    }
  )
})

test('reachability failure contains bind/connect diagnostics', async () => {
  const provider = createTargetProvider({
    mode: 'local',
    cwd: root,
    connectHost: '127.0.0.2'
  })
  const session = await provider.start({ entrypoint: './tests/fixtures/target.mjs' })

  try {
    await assert.rejects(session.waitReachable({ timeoutMs: 150, retryMs: 25 }), (error: unknown) => {
      assert.ok(error instanceof TargetUnreachableError)
      assert.equal((error.details as { bindHost: string }).bindHost, '127.0.0.1')
      assert.equal((error.details as { connectHost: string }).connectHost, '127.0.0.2')
      assert.equal((error.details as { port: number }).port, session.endpoint.port)
      assert.ok((error.details as { lastNetworkError: string }).lastNetworkError.length > 0)

      return true
    })
  } finally {
    await session.stop()
  }
})

test('runner crash closes agent stdio and does not orphan the target', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'benchkit-orphan-'))
  const pidFile = path.join(directory, 'target.pid')
  const runner = spawn(process.execPath, ['./tests/fixtures/start-and-hold.mjs', pidFile], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let output = ''

  runner.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })

  await waitFor(() => output.includes('READY '))
  const match = /READY (\d+)/u.exec(output)
  const targetPid = Number(match?.[1])

  assert.ok(Number.isInteger(targetPid) && targetPid > 0)
  assert.equal(isAlive(targetPid), true)
  runner.kill('SIGKILL')
  await waitFor(() => !isAlive(targetPid))
})

test('agent termination signal cleans up its target', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'benchkit-agent-signal-'))
  const pidFile = path.join(directory, 'target.pid')
  const configuration = Buffer.from(
    JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      benchkitVersion: BENCHKIT_VERSION,
      diagnosticsMaxBytes: 1024,
      commandMs: 500,
      shutdownGraceMs: 200,
      killMs: 200
    })
  ).toString('base64')
  const agent = spawn(process.execPath, ['./dist/agent/cli.js', '--stdio', '--config-base64', configuration], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const messages: Array<Record<string, unknown>> = []

  let buffered = ''

  agent.stdout.on('data', (chunk: Buffer) => {
    buffered += chunk.toString()

    let newline = buffered.indexOf('\n')

    while (newline !== -1) {
      messages.push(JSON.parse(buffered.slice(0, newline)) as Record<string, unknown>)
      buffered = buffered.slice(newline + 1)
      newline = buffered.indexOf('\n')
    }
  })

  await waitFor(() => messages.some((message) => message.type === 'agent:ready'))
  agent.stdin.write(
    `${JSON.stringify({
      version: PROTOCOL_VERSION,
      id: 'start-1',
      type: 'target:start',
      payload: {
        cwd: root,
        bindHost: '127.0.0.1',
        entrypoint: './tests/fixtures/target.mjs',
        args: [],
        execArgv: [],
        env: { BENCHKIT_FIXTURE_PID_FILE: pidFile },
        profile: false,
        targetReadyTimeoutMs: 2_000
      }
    })}\n`
  )
  await waitFor(() => messages.some((message) => message.id === 'start-1' && message.status === 'ok'))

  const targetPid = Number(await fs.readFile(pidFile, 'utf8'))

  assert.equal(isAlive(targetPid), true)
  agent.kill('SIGTERM')
  await once(agent, 'exit')
  await waitFor(() => !isAlive(targetPid))
})

test(
  'real SSH transport lifecycle',
  { skip: !process.env.BENCHKIT_SSH_DESTINATION || !process.env.BENCHKIT_SSH_CWD },
  async () => {
    const provider = createTargetProvider({
      mode: 'ssh',
      connectHost: process.env.BENCHKIT_SSH_CONNECT_HOST ?? '127.0.0.1',
      ssh: {
        destination: process.env.BENCHKIT_SSH_DESTINATION as string,
        cwd: process.env.BENCHKIT_SSH_CWD as string
      }
    })
    const session = await provider.start({
      entrypoint: './tests/fixtures/target.mjs'
    })

    await session.waitReachable()
    await session.stop()
  }
)
