import assert from 'node:assert/strict'
import test from 'node:test'
import { parseArgs } from '@swarmmachina/benchkit'

test('parseArgs copies defaults and consumes handled values', () => {
  const defaults = { runs: 1, verbose: false }
  const result = parseArgs(['node', 'bench.js', '--runs', '3', '--verbose', '--unknown'], defaults, {
    '--runs': (out, value) => {
      out.runs = Number(value)
    },
    '--verbose': (out) => {
      out.verbose = true

      return false
    }
  })

  assert.deepEqual(result, { runs: 3, verbose: true })
  assert.notEqual(result, defaults)
})

test('parseArgs strict mode accepts sliced argv and rejects unknown arguments', () => {
  const handlers = {
    '--runs': (out: { runs: number }, value: string | undefined) => {
      out.runs = Number(value)
    }
  }

  assert.deepEqual(parseArgs(['--runs', '3'], { runs: 1 }, handlers, { strict: true }), { runs: 3 })
  assert.throws(() => parseArgs(['--other', '3'], { runs: 1 }, handlers, { strict: true }), /unknown argument/)
})

test('parseArgs strict mode supports explicit offsets and validates missing values', () => {
  const handlers = {
    '--runs': (out: { runs: number }, value: string | undefined) => {
      out.runs = Number(value)
    },
    '--verbose': (out: { runs: number; verbose?: boolean }) => {
      out.verbose = true

      return false
    }
  }

  assert.deepEqual(
    parseArgs(['node', 'bench.js', '--runs', '4'], { runs: 1 }, handlers, {
      strict: true,
      offset: 2
    }),
    { runs: 4 }
  )
  assert.deepEqual(parseArgs(['--verbose'], { runs: 1 }, handlers, { strict: true }), {
    runs: 1,
    verbose: true
  })
  assert.throws(() => parseArgs(['--runs'], { runs: 1 }, handlers, { strict: true }), /missing value/)
  assert.throws(() => parseArgs(['--runs', '--verbose'], { runs: 1 }, handlers, { strict: true }), /missing value/)
})
