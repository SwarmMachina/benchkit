export type NullableNumber = number | null | undefined

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

export function finiteMedian(values: readonly NullableNumber[]): number | null {
  const finite = values.filter((value): value is number => Number.isFinite(value))

  return finite.length ? median(finite) : null
}
