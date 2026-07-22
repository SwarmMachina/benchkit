import assert from 'node:assert/strict'
import test from 'node:test'
import { shuffle } from '@swarmmachina/benchkit'

test('shuffle mutates and returns the same array while preserving its values', () => {
  const values = ['a', 'b', 'c', 'd']
  const result = shuffle(values)

  assert.equal(result, values)
  assert.deepEqual(result.toSorted(), ['a', 'b', 'c', 'd'])
})
