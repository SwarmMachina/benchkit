import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isNonBlankString,
  isNonNegativeFiniteNumber,
  isNonNegativeSafeInteger,
  isPositiveFiniteNumber,
  isPositiveSafeInteger,
  isRecord
} from '../../../dist/validation/predicates.js'
import {
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireNonNegativeNumber,
  requireObject,
  requirePositiveInteger,
  requirePositiveNumber
} from '../../../dist/validation/value-parsers.js'

test('shared validation predicates classify primitive invariants', () => {
  assert.equal(isRecord({}), true)
  assert.equal(isRecord([]), false)
  assert.equal(isNonBlankString(' value '), true)
  assert.equal(isNonBlankString('  '), false)
  assert.equal(isPositiveFiniteNumber(0.5), true)
  assert.equal(isPositiveFiniteNumber(Infinity), false)
  assert.equal(isNonNegativeFiniteNumber(0), true)
  assert.equal(isNonNegativeFiniteNumber(-1), false)
  assert.equal(isPositiveSafeInteger(1), true)
  assert.equal(isPositiveSafeInteger(1.5), false)
  assert.equal(isNonNegativeSafeInteger(0), true)
  assert.equal(isNonNegativeSafeInteger(Number.MAX_SAFE_INTEGER + 1), false)
})

test('shared value parsers preserve TypeError contracts and return valid values', () => {
  const object: unknown = { enabled: true }

  requireObject(object, 'options')

  assert.equal(object.enabled, true)
  assert.equal(requireNonEmptyString('name', 'name'), 'name')
  assert.equal(requirePositiveInteger(1, 'count'), 1)
  assert.equal(requireNonNegativeInteger(0, 'offset'), 0)
  assert.equal(requirePositiveNumber(0.5, 'rate'), 0.5)
  assert.equal(requireNonNegativeNumber(0, 'delay'), 0)
  assert.throws(() => requireObject([], 'options'), TypeError)
  assert.throws(() => requireNonEmptyString(' ', 'name'), /name must be a non-empty string/u)
  assert.throws(() => requirePositiveInteger(0, 'count'), /positive safe integer/u)
  assert.throws(() => requireNonNegativeInteger(-1, 'offset'), /non-negative safe integer/u)
  assert.throws(() => requirePositiveNumber(Infinity, 'rate'), /positive finite number/u)
  assert.throws(() => requireNonNegativeNumber(-1, 'delay'), /non-negative finite number/u)
})
