import assert from 'node:assert/strict'
import test from 'node:test'
import { bytesToMiB } from '@swarmmachina/benchkit/units'

test('bytesToMiB converts byte counts without rounding', () => {
  assert.equal(bytesToMiB(0), 0)
  assert.equal(bytesToMiB(1024 ** 2), 1)
  assert.equal(bytesToMiB(1.5 * 1024 ** 2), 1.5)
  assert.equal(bytesToMiB(-(1024 ** 2)), -1)
})
