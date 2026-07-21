import assert from 'node:assert/strict'
import test from 'node:test'
import { fmt, mdTable, round } from '../../src/step-summary.ts'

test('round rounds finite values to two decimal places', () => {
  assert.equal(round(1.236), 1.24)
  assert.equal(round(Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY)
})

test('fmt appends units and formats non-finite values as n/a', () => {
  assert.equal(fmt(12.345, '%'), '12.35%')
  assert.equal(fmt(Number.NaN, 'ms'), 'n/a')
})

test('mdTable renders a markdown table', () => {
  assert.equal(mdTable(['name', 'value'], [['rps', 100]]), '| name | value |\n| --- | --- |\n| rps | 100 |')
})
