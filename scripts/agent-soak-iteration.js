import assert from 'node:assert/strict'
import net from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { InvalidStateError } from '../dist/index.js'

const diagnosticsMaxBytes = 32 * 1024

export class AgentSoakIteration {
  #provider
  #index
  #metricsMs

  /**
   * @param {import('../dist/index.js').TargetProvider} provider
   * @param {number} index
   * @param {number} metricsMs
   */
  constructor(provider, index, metricsMs) {
    this.#provider = provider
    this.#index = index
    this.#metricsMs = metricsMs
  }

  /**
   * @returns {Promise<{
   *   startMs: number,
   *   reachableMs: number,
   *   stopMs: number,
   *   cpuCorePct: number,
   *   eluPct: number,
   *   rssPeakMB: number
   * }>}
   */
  async run() {
    const startedAt = performance.now()
    const session = await this.#provider.start({
      entrypoint: './tests/fixtures/target/target.mjs',
      ...(this.#index === 0 ? { args: ['--log-burst-bytes', '131072'] } : {})
    })
    const startMs = performance.now() - startedAt
    const reachableStartedAt = performance.now()

    let metrics
    let reachableMs
    let stopMs

    try {
      assert.equal(session.state, 'ready')
      assert.match(session.targetEnvironment.nodeVersion, /^v(?:22|24)\./u)
      await session.waitReachable({ verify: verifyFixture })

      reachableMs = performance.now() - reachableStartedAt

      await session.startMetrics({ sampleMs: 50 })

      if (this.#index === 0) {
        await assert.rejects(session.startMetrics(), InvalidStateError)
      }

      await delay(this.#metricsMs)
      metrics = await session.stopMetrics()

      assert.equal(session.state, 'ready')
      assert.ok(metrics.wallMs >= 1)
      assert.ok(metrics.cpuCorePct >= 0)
      assert.ok(metrics.eluPct >= 0)
      assert.ok(metrics.memMB.rssPeak > 0)
    } finally {
      const stopStartedAt = performance.now()

      await session.stop()
      stopMs = performance.now() - stopStartedAt
      await session.stop()

      assert.equal(session.state, 'stopped')
      assert.ok(Buffer.byteLength(session.diagnostics) <= diagnosticsMaxBytes)
    }

    return {
      startMs,
      reachableMs,
      stopMs,
      cpuCorePct: metrics.cpuCorePct,
      eluPct: metrics.eluPct,
      rssPeakMB: metrics.memMB.rssPeak
    }
  }
}

/**
 * @param {{host: string, port: number}} endpoint
 * @param {AbortSignal} signal
 * @returns {Promise<void>}
 */
function verifyFixture(endpoint, signal) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(endpoint)

    let response = ''
    let settled = false

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      socket.removeAllListeners()
      socket.destroy()
    }
    const settle = (error) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()

      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    const onAbort = () => settle(signal.reason instanceof Error ? signal.reason : new Error('verification aborted'))

    signal.addEventListener('abort', onAbort, { once: true })
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      response += chunk

      if (response.length > 16) {
        settle(new Error('fixture response exceeded 16 characters'))
      } else if (response.includes('\n')) {
        settle(response === 'ok\n' ? undefined : new Error(`unexpected fixture response: ${response}`))
      }
    })
    socket.once('error', settle)
    socket.once('end', () => {
      if (!settled) {
        settle(new Error(`fixture connection ended before a complete response: ${response}`))
      }
    })

    if (signal.aborted) {
      onAbort()
    }
  })
}
