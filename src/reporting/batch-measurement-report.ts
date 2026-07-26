import type { ScenarioMeasurement } from '../measurement/measure-scenario.js'
import { bytesToMiB } from '../units/bytes-to-mib.js'
import { fixedDecimal, optionalFixedDecimal } from './format.js'
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

/**
 * Renders scenario measurements as a GitHub-compatible Markdown table.
 * @param measurements Scenario measurements in display order.
 * @param options Optional parameter line and memory-peak column policy.
 * @param options.parameters Optional parameter text rendered above the table.
 * @param options.includeMemoryPeaks Whether to include heap and RSS peak columns.
 * @returns The parameter line, when supplied, followed by the measurement table.
 */
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
    fixedDecimal(measurement.durationMs),
    fixedDecimal(measurement.operationsPerSecond, 0),
    optionalFixedDecimal(measurement.latencyMs.p50, 4),
    optionalFixedDecimal(measurement.latencyMs.p95, 4),
    optionalFixedDecimal(measurement.latencyMs.p99, 4),
    fixedDecimal(measurement.eluPct),
    fixedDecimal(measurement.memoryDeltaMiB.heapUsed),
    fixedDecimal(measurement.memoryDeltaMiB.rss),
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

function optionalBytes(value: number | undefined): string {
  return value === undefined ? 'n/a' : fixedDecimal(bytesToMiB(value))
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ')
}
