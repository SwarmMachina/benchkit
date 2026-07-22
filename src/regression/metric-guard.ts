export interface MetricBound {
  min?: number
  max?: number
}

export interface MetricGuardBaselineTest {
  guards?: Record<string, MetricBound>
}

export interface MetricGuardParams {
  cases: string[]
  results: Record<string, Record<string, number>>
  baselineTests: Record<string, MetricGuardBaselineTest>
}

export interface MetricGuardRow {
  case: string
  metric: string
  value: number | undefined
  min: number | null
  max: number | null
  status: 'ok' | 'FAIL'
}

export interface MetricGuardResult {
  failures: string[]
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
