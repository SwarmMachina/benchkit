import assert from 'node:assert/strict'
import test from 'node:test'
import { fixed, fixedDecimal, fixedWithUnit, optionalFixedDecimal } from '@swarmmachina/benchkit/reporting'

test('fixed rounds nullable finite values for console tables', () => {
  assert.equal(fixed(null), 'n/a')
  assert.equal(fixed(1.234), 1.23)
  assert.equal(fixed(1.235), 1.24)
  assert.equal(fixed(Number.NaN), 'n/a')
})

test('fixedWithUnit preserves two decimals and appends a unit', () => {
  assert.equal(fixedWithUnit(1.2, 'ms'), '1.20ms')
  assert.equal(fixedWithUnit(Number.POSITIVE_INFINITY, 'ms'), 'n/a')
})

test('fixedDecimal preserves decimal width and rejects non-finite values', () => {
  assert.equal(fixedDecimal(1.2), '1.20')
  assert.equal(fixedDecimal(1.2345, 3), '1.234')
  assert.equal(fixedDecimal(Number.NaN), 'n/a')
})

test('optionalFixedDecimal formats missing measurements as n/a', () => {
  assert.equal(optionalFixedDecimal(null), 'n/a')
  assert.equal(optionalFixedDecimal(undefined), 'n/a')
  assert.equal(optionalFixedDecimal(12, 0), '12')
})
