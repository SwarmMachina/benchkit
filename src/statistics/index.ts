export { distribution } from './distribution.js'
export type { DistributionSummary } from './distribution.js'
export { default as median, finiteMedian } from './median.js'
export type { NullableNumber } from './median.js'
export { metricMedians } from './metric-medians.js'
export type { MetricRecord } from './metric-medians.js'
export { percentDelta } from './percent-delta.js'
export { pairedComparison, tukeyHinges } from './paired-comparison.js'
export type {
  ComparisonPair,
  PairedComparisonOptions,
  PairedComparisonResult,
  TukeyHinges
} from './paired-comparison.js'
export { quantileLinear, quantileNearestRank } from './quantile.js'
