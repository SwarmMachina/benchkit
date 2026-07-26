import type { ProcessMemorySummary } from '../../measurement/process-memory.js'
import type { LoadWorkerResult } from './load-worker-protocol.js'

export interface LoadCoordinatorParameters {
  connections: number
  workers: number
  durationMs: number
  warmupMs: number
  timeoutMs: number
}

export interface LoadCoordinatorOptions<Parameters extends LoadCoordinatorParameters> {
  parameters: Parameters
  startupTimeoutMs: number
  memorySampleMs: number
  signal?: AbortSignal
}

export interface LoadPhaseResult<WorkerResult extends LoadWorkerResult> {
  startedAt: Date
  finishedAt: Date
  durationMs: number
  workers: WorkerResult[]
  cpuMs: number
  parentEluPct: number
  processMemory: ProcessMemorySummary
}
