import assert from 'node:assert/strict'
import test from 'node:test'

import delay from '@swarmmachina/benchkit/delay'

test('delay resolves with the provided value', async () => {
  assert.equal(await delay(0, 'done'), 'done')
})
