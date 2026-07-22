import { finiteMedian, type NullableNumber } from './median.js'
import { quantileLinear } from './quantile.js'

export interface DistributionSummary {
  median: number | null
  q1: number | null
  q3: number | null
  values: number[]
}

export function distribution(values: readonly NullableNumber[]): DistributionSummary {
  const finite = values.filter((value): value is number => Number.isFinite(value))

  return {
    median: finiteMedian(finite),
    q1: quantileLinear(finite, 0.25),
    q3: quantileLinear(finite, 0.75),
    values: finite
  }
}
