import assert from 'node:assert/strict'
import test from 'node:test'
import { measureScenario, renderBatchMeasurementsMarkdown } from '@swarmmachina/benchkit'

test('batch measurement report renders parameters, tails, ELU and memory', async () => {
  const measurement = await measureScenario({
    name: 'event|storm',
    operations: 4,
    pipelining: 2,
    run: () => [1, 2, 3, 4]
  })
  const report = renderBatchMeasurementsMarkdown([measurement], {
    parameters: 'connections=1 iterations=4 request-pipelining=2',
    includeMemoryPeaks: false
  })

  assert.match(report, /^parameters: connections=1 iterations=4 request-pipelining=2/m)
  assert.match(report, /p95 ms/)
  assert.match(report, /p99 ms/)
  assert.match(report, /ELU %/)
  assert.match(report, /heap delta MiB/)
  assert.match(report, /event\\\|storm/)
})
