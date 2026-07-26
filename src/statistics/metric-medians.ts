import { finiteMedian, type NullableNumber } from './median.js'

/** Read-only metric-name map whose observations may be absent or non-finite. */
export type MetricRecord = Readonly<Record<string, NullableNumber>>

/**
 * Computes a finite median for every metric name observed across records.
 * @param values Metric records from repeated benchmark runs.
 * @returns Metric names mapped to their finite median or `null`.
 */
export function metricMedians(values: readonly MetricRecord[]): Record<string, number | null> {
  const names = new Set(values.flatMap((value) => Object.keys(value)))

  return Object.fromEntries([...names].map((name) => [name, finiteMedian(values.map((value) => value[name]))]))
}
