import os from 'node:os'
import {
  requireNonNegativeNumber,
  requirePositiveInteger,
  requirePositiveNumber
} from '../../validation/value-parsers.js'

const DEFAULT_CONNECTIONS = 10
const DEFAULT_DURATION_MS = 10_000
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000
const DEFAULT_MEMORY_SAMPLE_MS = 50

export interface CommonLoadOptionsInput {
  connections?: number
  workers?: number
  rate?: number
  correctCoordinatedOmission?: boolean
  durationMs?: number
  warmupMs?: number
  timeoutMs?: number
  startupTimeoutMs?: number
  memorySampleMs?: number
  signal?: AbortSignal
}

export interface NormalizedCommonLoadParameters {
  connections: number
  workers: number
  mode: 'closed-loop' | 'fixed-rate'
  rate: number | null
  correctCoordinatedOmission: boolean
  durationMs: number
  warmupMs: number
  timeoutMs: number
}

export interface NormalizedCommonLoadOptions {
  parameters: NormalizedCommonLoadParameters
  startupTimeoutMs: number
  memorySampleMs: number
  signal?: AbortSignal
}

export function normalizeCommonLoadOptions(options: CommonLoadOptionsInput): NormalizedCommonLoadOptions {
  const connections = requirePositiveInteger(options.connections ?? DEFAULT_CONNECTIONS, 'connections')
  const workers = requirePositiveInteger(
    options.workers ?? Math.min(4, os.availableParallelism(), connections),
    'workers'
  )
  const rate = options.rate === undefined ? null : requirePositiveNumber(options.rate, 'rate')

  if (workers > connections) {
    throw new RangeError('workers must not exceed connections')
  }

  if (options.correctCoordinatedOmission !== undefined && typeof options.correctCoordinatedOmission !== 'boolean') {
    throw new TypeError('correctCoordinatedOmission must be a boolean')
  }

  if (rate === null && options.correctCoordinatedOmission !== undefined) {
    throw new TypeError('correctCoordinatedOmission requires rate')
  }

  return {
    parameters: {
      connections,
      workers,
      mode: rate === null ? 'closed-loop' : 'fixed-rate',
      rate,
      correctCoordinatedOmission: rate === null ? false : (options.correctCoordinatedOmission ?? true),
      durationMs: requirePositiveNumber(options.durationMs ?? DEFAULT_DURATION_MS, 'durationMs'),
      warmupMs: requireNonNegativeNumber(options.warmupMs ?? 0, 'warmupMs'),
      timeoutMs: requirePositiveNumber(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs')
    },
    startupTimeoutMs: requirePositiveNumber(options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS, 'startupTimeoutMs'),
    memorySampleMs: requirePositiveNumber(options.memorySampleMs ?? DEFAULT_MEMORY_SAMPLE_MS, 'memorySampleMs'),
    ...(options.signal === undefined ? {} : { signal: options.signal })
  }
}
