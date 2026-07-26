import { isRecord } from '../validation/predicates.js'

/** Schema identifier required by regression baseline files. */
export const BASELINE_SCHEMA_VERSION = 'regression-ci-baseline/v1' as const

/** Benchmark identity and invocation metadata stored in a baseline. */
export interface BaselineBenchmark {
  /** Stable benchmark name. */
  name: string

  /** Package under measurement. */
  packageName: string

  /** Package version used during calibration. */
  packageVersion: string

  /** CI or local runner identifier. */
  runner: string

  /** Script or command used to execute the benchmark. */
  script: string

  /** Framework or implementation identifier. */
  framework: string

  /** Suite-specific benchmark metadata. */
  [key: string]: unknown
}

/** Provenance and status of baseline calibration. */
export interface BaselineCalibration {
  /** Calibration status such as `pending` or `calibrated`. */
  status: string

  /** ISO-8601 time of the latest calibration update. */
  updatedAt: string

  /** Node.js version used for calibration. */
  node: string

  /** CI runner used for calibration. */
  ciRunner: string

  /** Optional human-readable calibration note. */
  note?: string

  /** Suite-specific calibration metadata. */
  [key: string]: unknown
}

/** Display metadata for one baseline metric. */
export interface BaselineMetric {
  /** Human-readable metric label. */
  label: string

  /** Display unit; an empty string denotes a unitless metric. */
  unit: string

  /** Suite-specific metric metadata and thresholds. */
  [key: string]: unknown
}

/** Versioned benchmark regression baseline. */
export interface Baseline {
  /** Baseline schema identifier. */
  schemaVersion: typeof BASELINE_SCHEMA_VERSION

  /** Optional suite identifier. */
  suite?: string

  /** Benchmark identity and invocation metadata. */
  benchmark: BaselineBenchmark

  /** Calibration provenance and status. */
  calibration: BaselineCalibration

  /** Effective benchmark parameters. */
  parameters: Record<string, unknown>

  /** Metric metadata keyed by metric name. */
  metrics: Record<string, BaselineMetric>

  /** Forward-compatible suite-specific data. */
  [key: string]: unknown
}

/** Success or accumulated validation errors for an unknown baseline value. */
export type BaselineValidationResult =
  | {
      /** Indicates the value conforms to the baseline schema. */
      ok: true

      /** Empty tuple for a valid baseline. */
      errors: []
    }
  | {
      /** Indicates one or more schema violations. */
      ok: false

      /** Human-readable schema violations. */
      errors: string[]
    }

/**
 * Validates an unknown value against the versioned regression baseline schema.
 *
 * Validation accumulates human-readable failures and does not throw for
 * malformed or uninspectable input.
 * @param json Unknown value loaded from a baseline file.
 * @returns Success or every detected schema violation.
 */
export function validateBaseline(json: unknown): BaselineValidationResult {
  const errors: string[] = []

  try {
    if (!isRecord(json)) {
      return { ok: false, errors: ['baseline must be an object'] }
    }

    if (json.schemaVersion !== BASELINE_SCHEMA_VERSION) {
      errors.push(`schemaVersion must be ${BASELINE_SCHEMA_VERSION}`)
    }

    const benchmark = requireRecord(json, 'benchmark', errors)

    if (benchmark) {
      requireStrings(
        benchmark,
        ['name', 'packageName', 'packageVersion', 'runner', 'script', 'framework'],
        errors,
        'benchmark'
      )
    }

    const calibration = requireRecord(json, 'calibration', errors)

    if (calibration) {
      requireStrings(calibration, ['status', 'updatedAt', 'node', 'ciRunner'], errors, 'calibration')
    }

    requireRecord(json, 'parameters', errors)
    const metrics = requireRecord(json, 'metrics', errors)

    if (metrics) {
      for (const [name, metric] of Object.entries(metrics)) {
        if (!isRecord(metric)) {
          errors.push(`metrics.${name} must be an object`)
          continue
        }

        requireStrings(metric, ['label'], errors, `metrics.${name}`)

        if (typeof metric.unit !== 'string') {
          errors.push(`metrics.${name}.unit must be a string`)
        }
      }
    }
  } catch {
    errors.push('baseline could not be inspected')
  }

  return errors.length ? { ok: false, errors } : { ok: true, errors: [] }
}

/**
 * Tests whether a value conforms to the current baseline schema.
 * @param json Unknown candidate value.
 * @returns `true` when {@link validateBaseline} reports no errors.
 */
export function isBaseline(json: unknown): json is Baseline {
  return validateBaseline(json).ok
}

function requireRecord(record: Record<string, unknown>, key: string, errors: string[]): Record<string, unknown> | null {
  const value = record[key]

  if (!isRecord(value)) {
    errors.push(`${key} must be an object`)

    return null
  }

  return value
}

function requireStrings(record: Record<string, unknown>, keys: string[], errors: string[], path: string): void {
  for (const key of keys) {
    if (typeof record[key] !== 'string' || record[key] === '') {
      errors.push(`${path}.${key} must be a non-empty string`)
    }
  }
}
