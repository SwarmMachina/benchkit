import assert from 'node:assert/strict'
import test from 'node:test'
import { finiteMedian, median } from '@swarmmachina/benchkit'

test('median returns the middle value for an odd-sized input', () => {
  assert.equal(median([9, 1, 5]), 5)
})

test('median averages the middle values for an even-sized input', () => {
  assert.equal(median([4, 1, 3, 2]), 2.5)
})

test('median returns the only value', () => {
  assert.equal(median([7]), 7)
})

test('finiteMedian ignores non-finite and missing values', () => {
  assert.equal(finiteMedian([1, null, Number.NaN, 3, undefined]), 2)
  assert.equal(finiteMedian([null, Number.POSITIVE_INFINITY]), null)
})
