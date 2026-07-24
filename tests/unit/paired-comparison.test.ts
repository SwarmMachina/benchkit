import assert from 'node:assert/strict'
import test from 'node:test'
import { pairedComparison, tukeyHinges } from '@swarmmachina/benchkit'

test('pairedComparison preserves pair deltas and uses explicit Tukey hinges', () => {
  const result = pairedComparison([
    { candidate: 110, reference: 100 },
    { candidate: 90, reference: 100 },
    { candidate: 120, reference: 100 },
    { candidate: 100, reference: 100 },
    { candidate: 105, reference: 100 },
    { candidate: 95, reference: 100 }
  ])

  assert.equal(result.medianCandidate, 102.5)
  assert.equal(result.medianReference, 100)
  assert.deepEqual(result.pairedDeltasPct, [10, -10, 20, 0, 5, -5])
  assert.equal(result.medianPairedDeltaPct, 2.5)
  assert.equal(result.winningPairs, 3)
  assert.deepEqual(result.iqr, { algorithm: 'tukey-hinges', q1: -5, q3: 10 })
})

test('Tukey hinges remain distinct from linearly interpolated quartiles', () => {
  assert.deepEqual(tukeyHinges([1, 2, 3, 4, 5]), {
    algorithm: 'tukey-hinges',
    q1: 1.5,
    q3: 4.5
  })
})

test('pairedComparison supports lower-is-better wins', () => {
  const result = pairedComparison(
    [
      { candidate: 8, reference: 10 },
      { candidate: 11, reference: 10 }
    ],
    { direction: 'lower' }
  )

  assert.equal(result.winningPairs, 1)
  assert.deepEqual(result.pairedDeltasPct, [-20, 10])
})

test('pairedComparison rejects invalid pairs instead of filtering them', () => {
  assert.throws(
    () =>
      pairedComparison([
        { candidate: 1, reference: 1 },
        { candidate: Number.NaN, reference: 1 }
      ]),
    /candidate must be finite/
  )
  assert.throws(
    () =>
      pairedComparison([
        { candidate: 1, reference: 1 },
        { candidate: 1, reference: 0 }
      ]),
    /must not be zero/
  )
  assert.throws(() => tukeyHinges([1]), RangeError)
})
