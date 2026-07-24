import type { ScenarioMeasurement } from '../measurement/measure-scenario.js'
import { bytesToMiB } from '../units/bytes-to-mib.js'
import { mdTable } from './step-summary.js'

/** Presentation options for scenario measurement Markdown. */
export interface RenderBatchMeasurementsOptions {
  /** Optional parameter line rendered above the table. */
  parameters?: string

  /**
   * Includes heap and RSS peak columns.
   * @default `true` when any measurement contains process-memory samples.
   */
  includeMemoryPeaks?: boolean
}

export function renderBatchMeasurementsMarkdown(
  measurements: readonly ScenarioMeasurement[],
  {
    parameters,
    includeMemoryPeaks = measurements.some((measurement) => measurement.processMemory)
  }: RenderBatchMeasurementsOptions = {}
): string {
  const headers = [
    'scenario',
    'duration ms',
    'ops/s',
    'p50 ms',
    'p95 ms',
    'p99 ms',
    'ELU %',
    'heap delta MiB',
    'RSS delta MiB',
    ...(includeMemoryPeaks ? ['heap peak MiB', 'RSS peak MiB'] : [])
  ]
  const rows = measurements.map((measurement) => [
    escapeCell(measurement.name),
    fixed(measurement.durationMs),
    fixed(measurement.operationsPerSecond, 0),
    optionalFixed(measurement.latencyMs.p50, 4),
    optionalFixed(measurement.latencyMs.p95, 4),
    optionalFixed(measurement.latencyMs.p99, 4),
    fixed(measurement.eluPct),
    fixed(measurement.memoryDeltaMiB.heapUsed),
    fixed(measurement.memoryDeltaMiB.rss),
    ...(includeMemoryPeaks
      ? [
          optionalBytes(measurement.processMemory?.heapUsed.peakBytes),
          optionalBytes(measurement.processMemory?.rss.peakBytes)
        ]
      : [])
  ])
  const table = mdTable(headers, rows)

  return parameters ? `parameters: ${parameters}\n${table}` : table
}

function fixed(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n/a'
}

function optionalFixed(value: number | null | undefined, digits: number): string {
  return value === null || value === undefined ? 'n/a' : fixed(value, digits)
}

function optionalBytes(value: number | undefined): string {
  return value === undefined ? 'n/a' : fixed(bytesToMiB(value))
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ')
}
