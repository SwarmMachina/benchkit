import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { TargetProvider } from '../dist/index.js'

const diagnosticsMaxBytes = 32 * 1024

export class AgentSoakVerifier {
  #configuration
  #provider

  /**
   * @param {ReturnType<import('./agent-soak-config.js').resolveAgentSoakConfiguration>} configuration
   * @param {TargetProvider} provider
   */
  constructor(configuration, provider) {
    this.#configuration = configuration
    this.#provider = provider
  }

  /** @returns {Promise<number>} */
  async run() {
    await this.#verifyStartupFailure()
    await this.#verifyReadinessTimeout()

    const forcedStopMs = await this.#verifyForcedShutdown()

    await this.#verifyUnexpectedExit()

    return forcedStopMs
  }

  /** @returns {Promise<void>} */
  async #verifyStartupFailure() {
    await assert.rejects(
      this.#provider.start({
        entrypoint: './tests/fixtures/target/target.mjs',
        args: ['--fail-before-ready']
      }),
      (error) => {
        assert.ok(error instanceof Error)
        assert.match(JSON.stringify(error), /fixture startup failure/u)

        return true
      }
    )
  }

  /** @returns {Promise<void>} */
  async #verifyReadinessTimeout() {
    const provider = new TargetProvider(
      providerOptions(this.#configuration, {
        targetReadyMs: 100,
        shutdownGraceMs: 100,
        killMs: 300
      })
    )

    await assert.rejects(
      provider.start({
        entrypoint: './tests/fixtures/target/target.mjs',
        args: ['--ready-delay-ms', '10000']
      }),
      (error) => error instanceof Error && 'code' in error && error.code === 'TIMEOUT'
    )
  }

  /** @returns {Promise<number>} */
  async #verifyForcedShutdown() {
    const provider = new TargetProvider(
      providerOptions(this.#configuration, {
        shutdownGraceMs: 100,
        killMs: 500
      })
    )
    const session = await provider.start({
      entrypoint: './tests/fixtures/target/target.mjs',
      args: ['--hang-shutdown']
    })

    await session.waitReachable()

    const startedAt = performance.now()

    await session.stop()

    const stopMs = performance.now() - startedAt

    assert.equal(session.state, 'stopped')
    assert.ok(stopMs < 2_000)

    return stopMs
  }

  /** @returns {Promise<void>} */
  async #verifyUnexpectedExit() {
    const session = await this.#provider.start({
      entrypoint: './tests/fixtures/target/target.mjs',
      args: ['--exit-after-ready-ms', '100']
    })

    await session.waitReachable()
    await waitFor(() => session.state === 'failed', 2_000)
    await session.stop()

    assert.equal(session.state, 'failed')
  }
}

/**
 * @param {() => boolean} condition
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
async function waitFor(condition, timeoutMs) {
  const deadline = performance.now() + timeoutMs

  while (performance.now() < deadline) {
    if (condition()) {
      return
    }

    await delay(20)
  }

  throw new Error(`condition did not become true after ${timeoutMs}ms`)
}

/**
 * @param {ReturnType<import('./agent-soak-config.js').resolveAgentSoakConfiguration>} configuration
 * @param {Record<string, number>} [timeouts]
 * @returns {{
 *   mode: 'ssh',
 *   connectHost: string,
 *   diagnosticsMaxBytes: number,
 *   timeouts?: Record<string, number>,
 *   ssh: {destination: string, cwd: string}
 * }}
 */
function providerOptions(configuration, timeouts) {
  return {
    mode: 'ssh',
    connectHost: configuration.connectHost,
    diagnosticsMaxBytes,
    ...(timeouts ? { timeouts } : {}),
    ssh: {
      destination: configuration.destination,
      cwd: configuration.cwd
    }
  }
}
