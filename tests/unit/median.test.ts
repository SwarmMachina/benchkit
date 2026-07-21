import assert from 'node:assert/strict'
import test from 'node:test'
import median from '../../src/median.ts'

test('median returns the middle value for an odd-sized input', () => {
  assert.equal(median([9, 1, 5]), 5)
})

test('median averages the middle values for an even-sized input', () => {
  assert.equal(median([4, 1, 3, 2]), 2.5)
})

test('median returns the only value', () => {
  assert.equal(median([7]), 7)
})
