import MetricsDefault from '@swarmmachina/benchkit/metrics'
import metricGuardDefault, { type MetricGuardParams, type MetricGuardResult } from '@swarmmachina/benchkit/metric-guard'
import { measureBatch, Metrics } from '@swarmmachina/benchkit/measurement'
import { renderRegressionMarkdown } from '@swarmmachina/benchkit/regression'
import type { BenchmarkResult } from '@swarmmachina/benchkit/results'
import { finiteMedian, quantileLinear } from '@swarmmachina/benchkit/statistics'
import timed from '@swarmmachina/benchkit/timed'
import { bytesToMiB } from '@swarmmachina/benchkit/units'

const result: BenchmarkResult = {
  runs: [{ run: 1, rows: [{ fw: 'core' }] }]
}
const params: MetricGuardParams = {
  cases: [],
  results: {},
  baselineTests: {}
}
const guard: MetricGuardResult = metricGuardDefault(params)

void [
  Metrics,
  MetricsDefault,
  bytesToMiB,
  finiteMedian,
  guard,
  measureBatch,
  quantileLinear,
  renderRegressionMarkdown,
  result,
  timed
]
