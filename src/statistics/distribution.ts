import { finiteMedian, type NullableNumber } from './median.js'
import { quantileLinear } from './quantile.js'

/** Finite values and linearly interpolated distribution statistics. */
export interface DistributionSummary {
  /** Median finite value, or `null` when no finite values were supplied. */
  median: number | null

  /** Linearly interpolated first quartile, or `null` when empty. */
  q1: number | null

  /** Linearly interpolated third quartile, or `null` when empty. */
  q3: number | null

  /** Finite input values in original order. */
  values: number[]
}

/**
 * Summarizes finite observations with a median and linear quartiles.
 * @param values Numeric observations; missing and non-finite values are ignored.
 * @returns Finite input values in original order and their distribution statistics.
 */
export function distribution(values: readonly NullableNumber[]): DistributionSummary {
  const finite = values.filter((value): value is number => Number.isFinite(value))

  return {
    median: finiteMedian(finite),
    q1: quantileLinear(finite, 0.25),
    q3: quantileLinear(finite, 0.75),
    values: finite
  }
}
