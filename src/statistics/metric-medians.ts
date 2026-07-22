import { finiteMedian, type NullableNumber } from './median.js'

export type MetricRecord = Readonly<Record<string, NullableNumber>>

export function metricMedians(values: readonly MetricRecord[]): Record<string, number | null> {
  const names = new Set(values.flatMap((value) => Object.keys(value)))

  return Object.fromEntries([...names].map((name) => [name, finiteMedian(values.map((value) => value[name]))]))
}
