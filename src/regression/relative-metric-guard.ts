import { isNonNegativeFiniteNumber } from '../validation/predicates.js'

/** Direction in which a larger or smaller candidate value is preferable. */
export type MetricDirection = 'higher' | 'lower'

/** Candidate/reference comparison and tolerated regression policy for one metric. */
export interface RelativeMetricRule {
  /** Stable metric name used in failures and reports. */
  name: string

  /** Candidate measurement. */
  candidate: number

  /** Reference measurement. */
  reference: number

  /** Direction considered better. */
  direction: MetricDirection

  /** Maximum tolerated relative regression as a non-negative percentage. */
  maxRegressionPct: number

  /**
   * Additional absolute tolerance applied after the relative boundary.
   * @default `0`
   */
  absoluteSlack?: number
}

/** Relative metric rules supplied to `relativeMetricGuard`. */
export interface RelativeMetricGuardParams {
  /** Ordered rules to evaluate. */
  metrics: readonly RelativeMetricRule[]
}

/** One normalized relative regression evaluation. */
export interface RelativeMetricGuardRow {
  /** Stable metric name. */
  name: string

  /** Candidate measurement. */
  candidate: number

  /** Reference measurement. */
  reference: number

  /** Direction considered better. */
  direction: MetricDirection

  /** Configured tolerated relative regression percentage. */
  maxRegressionPct: number

  /** Effective non-negative absolute tolerance. */
  absoluteSlack: number

  /** Computed inclusive pass boundary, or `null` for invalid inputs. */
  boundary: number | null

  /** Evaluation status. */
  status: 'pass' | 'fail'
}

/** Aggregate status, failures, and rows for relative metric guards. */
export interface RelativeMetricGuardResult {
  /** `fail` when at least one rule failed. */
  status: 'pass' | 'fail'

  /** Human-readable validation and regression failures. */
  failures: string[]

  /** One normalized row for every supplied rule. */
  rows: RelativeMetricGuardRow[]
}

export function relativeMetricGuard({ metrics }: RelativeMetricGuardParams): RelativeMetricGuardResult {
  if (!Array.isArray(metrics)) {
    throw new TypeError('metrics must be an array')
  }

  const failures: string[] = []
  const rows = metrics.map((metric, index): RelativeMetricGuardRow => {
    validateRule(metric, index)

    const absoluteSlack = metric.absoluteSlack ?? 0
    const valuesAreFinite = Number.isFinite(metric.candidate) && Number.isFinite(metric.reference)
    const computedBoundary = valuesAreFinite
      ? metric.direction === 'higher'
        ? metric.reference - (metric.reference * metric.maxRegressionPct) / 100 - absoluteSlack
        : metric.reference + (metric.reference * metric.maxRegressionPct) / 100 + absoluteSlack
      : null
    const boundary = Number.isFinite(computedBoundary) ? computedBoundary : null

    let status: RelativeMetricGuardRow['status'] = 'pass'

    if (!Number.isFinite(metric.candidate)) {
      failures.push(`${metric.name}: candidate must be finite`)
      status = 'fail'
    }

    if (!Number.isFinite(metric.reference)) {
      failures.push(`${metric.name}: reference must be finite`)
      status = 'fail'
    }

    if (valuesAreFinite && boundary === null) {
      failures.push(`${metric.name}: computed boundary must be finite`)
      status = 'fail'
    }

    if (
      boundary !== null &&
      ((metric.direction === 'higher' && metric.candidate < boundary) ||
        (metric.direction === 'lower' && metric.candidate > boundary))
    ) {
      const relation = metric.direction === 'higher' ? 'below' : 'above'

      failures.push(`${metric.name}: candidate ${metric.candidate} is ${relation} boundary ${boundary}`)
      status = 'fail'
    }

    return {
      name: metric.name,
      candidate: metric.candidate,
      reference: metric.reference,
      direction: metric.direction,
      maxRegressionPct: metric.maxRegressionPct,
      absoluteSlack,
      boundary,
      status
    }
  })

  return {
    status: failures.length ? 'fail' : 'pass',
    failures,
    rows
  }
}

function validateRule(metric: RelativeMetricRule, index: number): void {
  if (!metric || typeof metric !== 'object') {
    throw new TypeError(`metrics[${index}] must be an object`)
  }

  if (typeof metric.name !== 'string' || !metric.name) {
    throw new TypeError(`metrics[${index}].name must be a non-empty string`)
  }

  if (metric.direction !== 'higher' && metric.direction !== 'lower') {
    throw new TypeError(`${metric.name}.direction must be "higher" or "lower"`)
  }

  if (!isNonNegativeFiniteNumber(metric.maxRegressionPct)) {
    throw new RangeError(`${metric.name}.maxRegressionPct must be a non-negative finite number`)
  }

  if (metric.absoluteSlack !== undefined && !isNonNegativeFiniteNumber(metric.absoluteSlack)) {
    throw new RangeError(`${metric.name}.absoluteSlack must be a non-negative finite number`)
  }
}
