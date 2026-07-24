import assert from 'node:assert/strict'
import test from 'node:test'
import { balancedSchedule } from '@swarmmachina/benchkit'

test('balancedSchedule deterministically alternates AB and BA', () => {
  assert.deepEqual(balancedSchedule({ runs: 4, candidate: 'swm', reference: 'uws' }), [
    { round: 1, order: ['swm', 'uws'] },
    { round: 2, order: ['uws', 'swm'] },
    { round: 3, order: ['swm', 'uws'] },
    { round: 4, order: ['uws', 'swm'] }
  ])
})

test('balancedSchedule rejects odd strict schedules and can allow one extra AB run', () => {
  assert.throws(() => balancedSchedule({ runs: 3 }), /must be even/)
  assert.equal(balancedSchedule({ runs: 3, strictBalance: false }).length, 3)
})

test('balancedSchedule validates run count and labels', () => {
  assert.throws(() => balancedSchedule({ runs: 0 }), RangeError)
  assert.throws(() => balancedSchedule({ runs: 2, candidate: 'same', reference: 'same' }), RangeError)
})
