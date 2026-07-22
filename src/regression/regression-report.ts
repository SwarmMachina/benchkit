import { fmt, mdTable } from '../reporting/step-summary.js'
import type { CpuGuardResult } from './cpu-guard.js'
import type { MetricGuardResult } from './metric-guard.js'

export interface RegressionReportInput {
  suite: string
  metric?: MetricGuardResult
  cpu?: CpuGuardResult
  failures?: readonly string[]
}

export function renderRegressionMarkdown({ suite, metric, cpu, failures = [] }: RegressionReportInput): string {
  const lines = [`## Regression profile — ${suite}`, '']
  const metricRows = metric?.rows ?? []
  const cpuRows = cpu?.rows ?? []
  const allFailures = [...(metric?.failures ?? []), ...(cpu?.failures ?? []), ...failures]

  if (metricRows.length) {
    lines.push(
      mdTable(
        ['case', 'metric', 'value', 'min', 'max', 'status'],
        metricRows.map((row) => [
          row.case,
          row.metric,
          fmt(row.value ?? Number.NaN),
          row.min ?? '—',
          row.max ?? '—',
          row.status === 'ok' ? '✅' : '❌'
        ])
      ),
      ''
    )
  }

  if (cpuRows.length) {
    lines.push(
      'CPU profiles:',
      '',
      mdTable(
        ['profile', 'ticks', 'JS', 'C++', 'GC', 'unaccounted'],
        cpuRows.map((row) => [
          row.key,
          row.ticks ?? '—',
          fmt(row.jsPct ?? Number.NaN, '%'),
          fmt(row.cppPct ?? Number.NaN, '%'),
          fmt(row.gcPct ?? Number.NaN, '%'),
          fmt(row.unaccountedPct ?? Number.NaN, '%')
        ])
      ),
      ''
    )
  }

  if (allFailures.length) {
    lines.push(`**Result:** ❌ ${allFailures.length} failure(s)`, ...allFailures.map((failure) => `- ${failure}`))
  } else {
    lines.push('**Result:** ✅ all guards passed')
  }

  return `${lines.join('\n')}\n`
}
