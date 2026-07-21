import assert from 'node:assert/strict'
import test from 'node:test'
import parseArgs from '../../src/parse-args.ts'

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
