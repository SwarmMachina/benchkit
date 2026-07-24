import median from './median.js'
import { percentDelta } from './percent-delta.js'

export interface ComparisonPair {
  candidate: number
  reference: number
}

export interface PairedComparisonOptions {
  direction?: 'higher' | 'lower'
}

export interface TukeyHinges {
  algorithm: 'tukey-hinges'
  q1: number
  q3: number
}

export interface PairedComparisonResult {
  medianCandidate: number
  medianReference: number
  pairedDeltasPct: number[]
  medianPairedDeltaPct: number
  winningPairs: number
  iqr: TukeyHinges
}

// This is the median-of-halves Tukey-hinges convention used by the source
// benchmark: the central value is excluded from both halves for odd samples.
export function tukeyHinges(values: readonly number[]): TukeyHinges {
  if (!Array.isArray(values) || values.length < 2) {
    throw new RangeError('Tukey hinges require at least two values')
  }

  validateFiniteValues(values, 'values')

  const sorted = values.toSorted((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const lower = sorted.slice(0, middle)
  const upper = sorted.slice(Math.ceil(sorted.length / 2))

  return {
    algorithm: 'tukey-hinges',
    q1: median(lower),
    q3: median(upper)
  }
}

export function pairedComparison(
  pairs: readonly ComparisonPair[],
  { direction = 'higher' }: PairedComparisonOptions = {}
): PairedComparisonResult {
  if (!Array.isArray(pairs) || pairs.length < 2) {
    throw new RangeError('paired comparison requires at least two pairs')
  }

  if (direction !== 'higher' && direction !== 'lower') {
    throw new TypeError('direction must be "higher" or "lower"')
  }

  const candidates: number[] = []
  const references: number[] = []
  const pairedDeltasPct: number[] = []

  let winningPairs = 0

  for (const [index, pair] of pairs.entries()) {
    if (!pair || typeof pair !== 'object') {
      throw new TypeError(`pairs[${index}] must be an object`)
    }

    if (!Number.isFinite(pair.candidate)) {
      throw new TypeError(`pairs[${index}].candidate must be finite`)
    }

    if (!Number.isFinite(pair.reference)) {
      throw new TypeError(`pairs[${index}].reference must be finite`)
    }

    const delta = percentDelta(pair.candidate, pair.reference)

    if (delta === null) {
      throw new RangeError(`pairs[${index}].reference must not be zero`)
    }

    candidates.push(pair.candidate)
    references.push(pair.reference)
    pairedDeltasPct.push(delta)

    if (
      (direction === 'higher' && pair.candidate > pair.reference) ||
      (direction === 'lower' && pair.candidate < pair.reference)
    ) {
      winningPairs++
    }
  }

  return {
    medianCandidate: median(candidates),
    medianReference: median(references),
    pairedDeltasPct,
    medianPairedDeltaPct: median(pairedDeltasPct),
    winningPairs,
    iqr: tukeyHinges(pairedDeltasPct)
  }
}

function validateFiniteValues(values: readonly number[], name: string): void {
  for (const [index, value] of values.entries()) {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${name}[${index}] must be finite`)
    }
  }
}
