import assert from 'node:assert/strict'
import test from 'node:test'
import { renderRegressionMarkdown } from '@swarmmachina/benchkit'

test('renderRegressionMarkdown renders metric and CPU guard results', () => {
  const markdown = renderRegressionMarkdown({
    suite: 'http',
    metric: {
      rows: [{ case: 'base', metric: 'rps', value: 90, min: 100, max: null, status: 'FAIL' }],
      failures: ['base.rps: 90 < 100']
    },
    cpu: {
      rows: [{ key: 'base:1:core', ticks: 200, jsPct: 60, cppPct: 20, gcPct: 5, unaccountedPct: 15 }],
      failures: []
    }
  })

  assert.match(markdown, /^## Regression profile — http$/m)
  assert.match(markdown, /\| base \| rps \| 90 \| 100 \| — \| ❌ \|/)
  assert.match(markdown, /\| base:1:core \| 200 \| 60% \| 20% \| 5% \| 15% \|/)
  assert.match(markdown, /\*\*Result:\*\* ❌ 1 failure\(s\)/)
  assert.match(markdown, /- base\.rps: 90 < 100/)
  assert.ok(markdown.endsWith('\n'))
})

test('renderRegressionMarkdown renders a passing empty report', () => {
  assert.equal(
    renderRegressionMarkdown({ suite: 'ws' }),
    '## Regression profile — ws\n\n**Result:** ✅ all guards passed\n'
  )
})
