import { TargetProvider } from '../dist/index.js'
import { fixedWithUnit } from '../dist/reporting/format.js'
import { summarizeAgentSoakValues } from './agent-soak-config.js'
import { AgentSoakIteration } from './agent-soak-iteration.js'
import { AgentSoakVerifier } from './agent-soak-verifier.js'

const diagnosticsMaxBytes = 32 * 1024

export class AgentSoakRunner {
  #configuration
  #provider
  #verifier
  #results
  #next = 0
  #failed = false

  /** @param {ReturnType<import('./agent-soak-config.js').resolveAgentSoakConfiguration>} configuration */
  constructor(configuration) {
    this.#configuration = configuration
    this.#provider = new TargetProvider({
      mode: 'ssh',
      connectHost: configuration.connectHost,
      diagnosticsMaxBytes,
      ssh: {
        destination: configuration.destination,
        cwd: configuration.cwd
      }
    })
    this.#verifier = new AgentSoakVerifier(configuration, this.#provider)
    this.#results = new Array(configuration.iterations)
  }

  /** @returns {Promise<void>} */
  async run() {
    const startedAt = performance.now()

    await Promise.all(Array.from({ length: this.#configuration.concurrency }, () => this.#runConcurrentSlot()))

    const forcedStopMs = await this.#verifier.run()

    report(this.#configuration, this.#results, forcedStopMs, performance.now() - startedAt)
  }

  /** @returns {Promise<void>} */
  async #runConcurrentSlot() {
    while (!this.#failed) {
      const index = this.#next++

      if (index >= this.#configuration.iterations) {
        return
      }

      try {
        const iteration = new AgentSoakIteration(this.#provider, index, this.#configuration.metricsMs)

        this.#results[index] = await iteration.run()
      } catch (error) {
        this.#failed = true
        throw error
      }
    }
  }
}

/**
 * @param {string} name
 * @param {number[]} values
 * @param {string} unit
 * @returns {string}
 */
function reportRow(name, values, unit) {
  const summary = summarizeAgentSoakValues(values)

  return `| ${name} | ${fixedWithUnit(summary.p50, unit)} | ${fixedWithUnit(summary.p95, unit)} | ${fixedWithUnit(summary.p99, unit)} | ${fixedWithUnit(summary.max, unit)} |`
}

/**
 * @param {ReturnType<import('./agent-soak-config.js').resolveAgentSoakConfiguration>} configuration
 * @param {Array<Awaited<ReturnType<AgentSoakIteration['run']>>>} results
 * @param {number} forcedStopMs
 * @param {number} elapsedMs
 * @returns {void}
 */
function report(configuration, results, forcedStopMs, elapsedMs) {
  const values = (name) => results.map((result) => result[name])

  console.log(
    `agent SSH soak: iterations=${configuration.iterations}, concurrency=${configuration.concurrency}, ` +
      `metricsMs=${configuration.metricsMs}, throughput=${fixedWithUnit((configuration.iterations / elapsedMs) * 1_000, ' sessions/s')}`
  )
  console.log('| metric | p50 | p95 | p99 | max |')
  console.log('| --- | ---: | ---: | ---: | ---: |')
  console.log(reportRow('start', values('startMs'), 'ms'))
  console.log(reportRow('reachable', values('reachableMs'), 'ms'))
  console.log(reportRow('stop', values('stopMs'), 'ms'))
  console.log(reportRow('target CPU', values('cpuCorePct'), '%'))
  console.log(reportRow('target ELU', values('eluPct'), '%'))
  console.log(reportRow('target RSS peak', values('rssPeakMB'), 'MiB'))
  console.log(`forced shutdown: ${fixedWithUnit(forcedStopMs, 'ms')}`)
}
