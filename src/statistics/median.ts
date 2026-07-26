/** Numeric observation that may be absent or explicitly null. */
export type NullableNumber = number | null | undefined

/**
 * Computes the median without mutating the input.
 * @param values Numeric observations.
 * @returns The middle value, the mean of two middle values, or `NaN` when empty.
 */
export default function median(values: readonly number[]): number {
  const a = values.toSorted((x, y) => x - y)
  const mid = (a.length / 2) | 0

  if (!a.length) {
    return Number.NaN
  }

  if (a.length % 2) {
    return a[mid] ?? Number.NaN
  }

  const lower = a[mid - 1]
  const upper = a[mid]

  return lower === undefined || upper === undefined ? Number.NaN : (lower + upper) / 2
}

/**
 * Computes a median after discarding missing and non-finite observations.
 * @param values Nullable numeric observations.
 * @returns The finite median, or `null` when no finite values remain.
 */
export function finiteMedian(values: readonly NullableNumber[]): number | null {
  const finite = values.filter((value): value is number => Number.isFinite(value))

  return finite.length ? median(finite) : null
}
