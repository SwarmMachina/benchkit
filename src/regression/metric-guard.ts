/** Optional inclusive lower and upper bounds for one metric. */
export interface MetricBound {
  /** Inclusive minimum accepted value. */
  min?: number

  /** Inclusive maximum accepted value. */
  max?: number
}

/** Guard configuration for one named benchmark case. */
export interface MetricGuardBaselineTest {
  /** Bounds keyed by metric name. */
  guards?: Record<string, MetricBound>
}

/** Cases, measurements, and bounds supplied to `metricGuard`. */
export interface MetricGuardParams {
  /** Ordered benchmark case names to validate. */
  cases: string[]

  /** Actual finite measurements keyed by case and metric. */
  results: Record<string, Record<string, number>>

  /** Expected metric bounds keyed by case. */
  baselineTests: Record<string, MetricGuardBaselineTest>
}

/** One evaluated absolute metric bound. */
export interface MetricGuardRow {
  /** Benchmark case name. */
  case: string

  /** Metric name. */
  metric: string

  /** Actual value, or `undefined` when missing. */
  value: number | undefined

  /** Inclusive minimum, or `null` when not configured. */
  min: number | null

  /** Inclusive maximum, or `null` when not configured. */
  max: number | null

  /** Evaluation status. */
  status: 'ok' | 'FAIL'
}

/** Absolute metric guard failures and evaluated rows. */
export interface MetricGuardResult {
  /** Human-readable missing-data and bound violations. */
  failures: string[]

  /** Evaluated metric rows. */
  rows: MetricGuardRow[]
}

export default function metricGuard({ cases, results, baselineTests }: MetricGuardParams): MetricGuardResult {
  const failures: string[] = []
  const rows: MetricGuardRow[] = []

  for (const name of cases) {
    const actual = results[name] || {}
    const expected = baselineTests?.[name]

    if (!expected) {
      failures.push(`${name}: missing baseline`)
      continue
    }

    const guards = expected.guards || {}

    for (const [metric, bound] of Object.entries(guards)) {
      const value = actual[metric]
      const hasMin = bound.min != null
      const hasMax = bound.max != null
      const row: MetricGuardRow = {
        case: name,
        metric,
        value,
        min: hasMin ? (bound.min as number) : null,
        max: hasMax ? (bound.max as number) : null,
        status: 'ok'
      }

      if (typeof value !== 'number' || !Number.isFinite(value)) {
        failures.push(`${name}.${metric}: missing value`)
        row.status = 'FAIL'
      } else {
        if (hasMin && value < (bound.min as number)) {
          failures.push(`${name}.${metric}: ${value} < ${bound.min}`)
          row.status = 'FAIL'
        }

        if (hasMax && value > (bound.max as number)) {
          failures.push(`${name}.${metric}: ${value} > ${bound.max}`)
          row.status = 'FAIL'
        }
      }

      rows.push(row)
    }
  }

  return { failures, rows }
}
