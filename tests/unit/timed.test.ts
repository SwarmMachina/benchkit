import assert from 'node:assert/strict'
import test from 'node:test'
import timed from '@swarmmachina/benchkit/timed'

test('timed returns the operation result and elapsed milliseconds', async () => {
  const result = await timed(() => 42)

  assert.equal(result.result, 42)
  assert.ok(result.ms >= 0)
})

test('timed annotates and rethrows errors', async () => {
  const failure = new Error('expected') as Error & { _timedMs?: number }

  await assert.rejects(
    timed(() => {
      throw failure
    }),
    (error) => error === failure
  )
  assert.ok(typeof failure._timedMs === 'number')
  assert.ok(failure._timedMs >= 0)
})
