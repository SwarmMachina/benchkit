import delayDefault from '@swarmmachina/benchkit/delay'
import getFreePortDefault, { type GetFreePortOptions } from '@swarmmachina/benchkit/get-free-port'
import MetricsDefault from '@swarmmachina/benchkit/metrics'
import metricGuardDefault, { type MetricGuardParams, type MetricGuardResult } from '@swarmmachina/benchkit/metric-guard'
import {
  runHttp1Load,
  type Http1LoadMode,
  type Http1LoadResult,
  type Http1LoadTransportMetrics
} from '@swarmmachina/benchkit/load/http1'
import {
  runWebSocketLoad,
  type WebSocketLoadMode,
  type WebSocketLoadResult,
  type WebSocketLoadTransportMetrics
} from '@swarmmachina/benchkit/load/websocket'
import {
  BoundedLatencyRecorder,
  forceGc,
  measureBatch,
  measureMemoryGrowth,
  measureScenario,
  Metrics,
  ProcessMemorySampler
} from '@swarmmachina/benchkit/measurement'
import {
  balancedSchedule,
  delay,
  getFreePort,
  terminateChildProcess,
  waitForChildExit
} from '@swarmmachina/benchkit/orchestration'
import { normalizePerfCounters, parsePerfStat, sampleV8HeapAllocations } from '@swarmmachina/benchkit/profiling'
import { renderRegressionMarkdown } from '@swarmmachina/benchkit/regression'
import { createBenchmarkArtifact, type BenchmarkResult } from '@swarmmachina/benchkit/results'
import { renderBatchMeasurementsMarkdown } from '@swarmmachina/benchkit/reporting'
import { finiteMedian, pairedComparison, quantileLinear, tukeyHinges } from '@swarmmachina/benchkit/statistics'
import timed from '@swarmmachina/benchkit/timed'
import { bytesToMiB } from '@swarmmachina/benchkit/units'
import { TargetRuntime } from '@swarmmachina/benchkit/target'
import { BENCHKIT_VERSION, PROTOCOL_VERSION, TargetProvider, type TargetSession } from '@swarmmachina/benchkit'

const result: BenchmarkResult = {
  runs: [{ run: 1, rows: [{ fw: 'core' }] }]
}
const params: MetricGuardParams = {
  cases: [],
  results: {},
  baselineTests: {}
}
const guard: MetricGuardResult = metricGuardDefault(params)
const provider = new TargetProvider({ mode: 'local' })
const runtime = new TargetRuntime()
const session = undefined as TargetSession | undefined
const portOptions: GetFreePortOptions = { host: '127.0.0.1' }
const httpResult = undefined as Http1LoadResult | undefined
const httpMode: Http1LoadMode = 'fixed-rate'
const httpTransport = undefined as Http1LoadTransportMetrics | undefined
const websocketResult = undefined as WebSocketLoadResult | undefined
const websocketMode: WebSocketLoadMode = 'closed-loop'
const websocketTransport = undefined as WebSocketLoadTransportMetrics | undefined

void [
  Metrics,
  MetricsDefault,
  bytesToMiB,
  delay,
  delayDefault,
  finiteMedian,
  getFreePort,
  getFreePortDefault,
  guard,
  httpResult,
  httpMode,
  httpTransport,
  websocketResult,
  websocketMode,
  websocketTransport,
  measureBatch,
  quantileLinear,
  renderRegressionMarkdown,
  result,
  timed,
  BENCHKIT_VERSION,
  PROTOCOL_VERSION,
  provider,
  portOptions,
  runtime,
  session,
  balancedSchedule({ runs: 2 }),
  new BoundedLatencyRecorder(),
  createBenchmarkArtifact({ suite: 'types', parameters: {}, results: [] }),
  forceGc,
  measureMemoryGrowth,
  measureScenario,
  new ProcessMemorySampler(),
  normalizePerfCounters(parsePerfStat('1,,cycles'), 1),
  pairedComparison([
    { candidate: 1, reference: 2 },
    { candidate: 2, reference: 1 }
  ]),
  sampleV8HeapAllocations,
  renderBatchMeasurementsMarkdown,
  runHttp1Load,
  runWebSocketLoad,
  terminateChildProcess,
  waitForChildExit,
  tukeyHinges([1, 2])
]
