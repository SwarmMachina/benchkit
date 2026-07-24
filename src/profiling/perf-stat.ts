export type PerfCounterStatus = 'counted' | 'not-supported' | 'not-counted'

export interface PerfStatCounter {
  event: string
  value: number | null
  unit: string | null
  status: PerfCounterStatus
  runtime: number | null
  runningPct: number | null
}

export interface NormalizedPerfStatCounter extends PerfStatCounter {
  perOperation: number | null
}

export function parsePerfStat(input: string): PerfStatCounter[] {
  if (typeof input !== 'string') {
    throw new TypeError('perf stat input must be a string')
  }

  const counters: PerfStatCounter[] = []

  for (const [lineIndex, rawLine] of input.split(/\r?\n/).entries()) {
    const line = rawLine.trim()

    if (!line || line.startsWith('#')) {
      continue
    }

    const fields = rawLine.split(',').map((value) => value.trim())

    if (fields.length < 3 || !fields[2]) {
      throw new TypeError(`invalid perf stat line ${lineIndex + 1}`)
    }

    const rawValue = fields[0] ?? ''
    const unavailable = unavailableStatus(rawValue)
    const value = unavailable ? null : parseFinite(rawValue, `line ${lineIndex + 1} value`)

    counters.push({
      event: fields[2],
      value,
      unit: fields[1] || null,
      status: unavailable ?? 'counted',
      runtime: optionalFinite(fields[3], `line ${lineIndex + 1} runtime`),
      runningPct: optionalFinite(fields[4], `line ${lineIndex + 1} running percentage`)
    })
  }

  return counters
}

export function normalizePerfCounters(
  counters: readonly PerfStatCounter[],
  operations: number
): NormalizedPerfStatCounter[] {
  if (!Array.isArray(counters)) {
    throw new TypeError('counters must be an array')
  }

  if (!Number.isFinite(operations) || operations <= 0) {
    throw new RangeError('operations must be a positive finite number')
  }

  return counters.map((counter, index) => {
    if (
      !counter ||
      typeof counter.event !== 'string' ||
      (counter.value !== null && !Number.isFinite(counter.value)) ||
      !['counted', 'not-supported', 'not-counted'].includes(counter.status) ||
      (counter.status === 'counted' && counter.value === null) ||
      (counter.status !== 'counted' && counter.value !== null)
    ) {
      throw new TypeError(`counters[${index}] is invalid`)
    }

    return {
      ...counter,
      perOperation: counter.value === null ? null : counter.value / operations
    }
  })
}

function unavailableStatus(value: string): Exclude<PerfCounterStatus, 'counted'> | null {
  if (value === '<not supported>') {
    return 'not-supported'
  }

  if (value === '<not counted>') {
    return 'not-counted'
  }

  if (value.startsWith('<')) {
    throw new TypeError(`unsupported perf stat value marker: ${value}`)
  }

  return null
}

function parseFinite(value: string, name: string): number {
  const parsed = Number(value)

  if (!value || !Number.isFinite(parsed)) {
    throw new TypeError(`${name} must be finite`)
  }

  return parsed
}

function optionalFinite(value: string | undefined, name: string): number | null {
  return value ? parseFinite(value, name) : null
}
