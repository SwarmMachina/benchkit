/**
 * @param {Record<string, string | undefined>} environment
 * @returns {{
 *   destination: string,
 *   connectHost: string,
 *   cwd: string,
 *   iterations: number,
 *   concurrency: number,
 *   metricsMs: number
 * }}
 */
export function resolveAgentSoakConfiguration(environment) {
  const destination = requiredEnvironment(environment, 'BENCHKIT_SSH_DESTINATION')
  const connectHost = requiredEnvironment(environment, 'BENCHKIT_SSH_CONNECT_HOST')
  const cwd = requiredEnvironment(environment, 'BENCHKIT_SSH_CWD')
  const iterations = boundedIntegerEnvironment(environment, 'BENCHKIT_SSH_SOAK_ITERATIONS', 20, 1, 200)
  const concurrency = boundedIntegerEnvironment(environment, 'BENCHKIT_SSH_SOAK_CONCURRENCY', 4, 1, 16)
  const metricsMs = boundedIntegerEnvironment(environment, 'BENCHKIT_SSH_SOAK_METRICS_MS', 100, 50, 5_000)

  if (concurrency > iterations) {
    throw new Error('BENCHKIT_SSH_SOAK_CONCURRENCY cannot exceed BENCHKIT_SSH_SOAK_ITERATIONS')
  }

  return { destination, connectHost, cwd, iterations, concurrency, metricsMs }
}

/**
 * @param {number[]} values
 * @returns {{p50: number, p95: number, p99: number, max: number}}
 */
export function summarizeAgentSoakValues(values) {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new TypeError('soak summary requires finite values')
  }

  const sorted = values.toSorted((left, right) => left - right)

  return {
    p50: nearestRank(sorted, 0.5),
    p95: nearestRank(sorted, 0.95),
    p99: nearestRank(sorted, 0.99),
    max: sorted.at(-1)
  }
}

/**
 * @param {Record<string, string | undefined>} environment
 * @param {string} name
 * @returns {string}
 */
function requiredEnvironment(environment, name) {
  const value = environment[name]

  if (!value) {
    throw new Error(`missing agent soak environment: ${name}`)
  }

  return value
}

/**
 * @param {Record<string, string | undefined>} environment
 * @param {string} name
 * @param {number} fallback
 * @param {number} minimum
 * @param {number} maximum
 * @returns {number}
 */
function boundedIntegerEnvironment(environment, name, fallback, minimum, maximum) {
  const raw = environment[name]
  const value = raw === undefined ? fallback : Number(raw)

  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}`)
  }

  return value
}

/**
 * @param {number[]} sorted
 * @param {number} quantile
 * @returns {number}
 */
function nearestRank(sorted, quantile) {
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]
}
