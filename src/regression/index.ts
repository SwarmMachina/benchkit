export { BASELINE_SCHEMA_VERSION, isBaseline, validateBaseline } from './baseline.js'
export type {
  Baseline,
  BaselineBenchmark,
  BaselineCalibration,
  BaselineMetric,
  BaselineValidationResult
} from './baseline.js'
export { default as cpuGuard } from './cpu-guard.js'
export type { CpuGuardConfig, CpuGuardParams, CpuGuardResult, CpuGuardRow, CpuProfile } from './cpu-guard.js'
export { default as metricGuard } from './metric-guard.js'
export type {
  MetricBound,
  MetricGuardBaselineTest,
  MetricGuardParams,
  MetricGuardResult,
  MetricGuardRow
} from './metric-guard.js'
export { renderRegressionMarkdown } from './regression-report.js'
export type { RegressionReportInput } from './regression-report.js'
