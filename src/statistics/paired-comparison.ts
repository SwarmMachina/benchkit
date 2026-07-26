import median from './median.js'
import { percentDelta } from './percent-delta.js'

/** One matched candidate/reference observation. */
export interface ComparisonPair {
  /** Candidate measurement. */
  candidate: number

  /** Reference measurement used as the percentage-delta denominator. */
  reference: number
}

/** Options controlling how paired wins are counted. */
export interface PairedComparisonOptions {
  /**
   * Metric direction considered a win for the candidate.
   * @default `'higher'`
   */
  direction?: 'higher' | 'lower'
}

/** Median-of-halves Tukey hinges for a finite distribution. */
export interface TukeyHinges {
  /** Explicit quartile algorithm identifier. */
  algorithm: 'tukey-hinges'

  /** Median of the lower half. */
  q1: number

  /** Median of the upper half. */
  q3: number
}

/** Aggregate statistics for matched candidate/reference observations. */
export interface PairedComparisonResult {
  /** Median candidate measurement. */
  medianCandidate: number

  /** Median reference measurement. */
  medianReference: number

  /** Signed `(candidate - reference) / reference * 100` value for every pair. */
  pairedDeltasPct: number[]

  /** Median of the signed paired percentage deltas. */
  medianPairedDeltaPct: number

  /** Number of pairs won according to the configured direction. */
  winningPairs: number

  /** Tukey hinges calculated over paired percentage deltas. */
  iqr: TukeyHinges
}

/**
 * Computes median-of-halves Tukey hinges for a finite distribution.
 *
 * The central value is excluded from both halves for odd sample counts.
 * @param values At least two finite observations.
 * @returns Explicit Tukey first and third hinges.
 * @throws {RangeError} If fewer than two observations are supplied.
 * @throws {TypeError} If any observation is non-finite.
 */
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

/**
 * Compares matched candidate/reference observations without breaking pairing.
 * @param pairs At least two finite candidate/reference pairs.
 * @param options Direction used to count candidate wins.
 * @param options.direction Whether a higher or lower candidate value wins.
 * @returns Medians, signed pair deltas, wins, and Tukey hinges.
 * @throws {TypeError} If a pair or direction is invalid.
 * @throws {RangeError} If fewer than two pairs exist or a reference is zero.
 */
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
