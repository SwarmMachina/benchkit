import assert from 'node:assert/strict'
import test from 'node:test'
import { numberEnvironment } from '../../../scripts/helpers/environment.js'

const name = 'BENCHKIT_TEST_NUMBER'

test('numberEnvironment returns the parsed environment value', () => {
  process.env[name] = '12.5'

  try {
    assert.equal(numberEnvironment(name), 12.5)
  } finally {
    delete process.env[name]
  }
})

test('numberEnvironment returns the fallback or undefined when the variable is absent', () => {
  delete process.env[name]

  assert.equal(numberEnvironment(name, 10), 10)
  assert.equal(numberEnvironment(name), undefined)
})

test('numberEnvironment rejects non-positive and non-finite values', () => {
  try {
    for (const value of ['0', '-1', 'NaN', 'Infinity']) {
      process.env[name] = value

      assert.throws(() => numberEnvironment(name), {
        name: 'TypeError',
        message: `${name} must be a positive number`
      })
    }
  } finally {
    delete process.env[name]
  }
})
