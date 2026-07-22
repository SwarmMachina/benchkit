import type { NullableNumber } from './median.js'

export function quantileLinear(values: readonly NullableNumber[], quantile: number): number | null {
  validateQuantile(quantile)

  const sorted = finiteSorted(values)

  if (!sorted.length) {
    return null
  }

  const index = (sorted.length - 1) * quantile
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const lowerValue = sorted[lower]
  const upperValue = sorted[upper]

  if (lowerValue === undefined || upperValue === undefined) {
    return null
  }

  if (lower === upper) {
    return lowerValue
  }

  return lowerValue + (upperValue - lowerValue) * (index - lower)
}

export function quantileNearestRank(values: readonly NullableNumber[], quantile: number): number | null {
  validateQuantile(quantile)

  const sorted = finiteSorted(values)

  if (!sorted.length) {
    return null
  }

  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1)

  return sorted[Math.min(sorted.length - 1, index)] ?? null
}

function finiteSorted(values: readonly NullableNumber[]): number[] {
  return values.filter((value): value is number => Number.isFinite(value)).toSorted((left, right) => left - right)
}

function validateQuantile(quantile: number): void {
  if (!Number.isFinite(quantile) || quantile < 0 || quantile > 1) {
    throw new RangeError('quantile must be a finite number between 0 and 1')
  }
}
