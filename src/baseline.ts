export const BASELINE_SCHEMA_VERSION = 'regression-ci-baseline/v1' as const

export interface BaselineBenchmark {
  name: string
  packageName: string
  packageVersion: string
  runner: string
  script: string
  framework: string
  [key: string]: unknown
}

export interface BaselineCalibration {
  status: string
  updatedAt: string
  node: string
  ciRunner: string
  note?: string
  [key: string]: unknown
}

export interface BaselineMetric {
  label: string
  unit: string
  [key: string]: unknown
}

export interface Baseline {
  schemaVersion: typeof BASELINE_SCHEMA_VERSION
  suite?: string
  benchmark: BaselineBenchmark
  calibration: BaselineCalibration
  parameters: Record<string, unknown>
  metrics: Record<string, BaselineMetric>
  [key: string]: unknown
}

export type BaselineValidationResult =
  | {
      ok: true
      errors: []
    }
  | {
      ok: false
      errors: string[]
    }

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

export function isBaseline(json: unknown): json is Baseline {
  return validateBaseline(json).ok
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
