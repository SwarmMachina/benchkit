import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeLoadUrl } from '../../../../dist/load/shared/load-url.js'
import { normalizeCommonLoadOptions } from '../../../../dist/load/shared/normalize-common-load-options.js'
import { requireNonNegativeInteger, requireObject } from '../../../../dist/validation/value-parsers.js'

test('normalizeCommonLoadOptions applies shared defaults and fixed-rate policy', () => {
  const defaults = normalizeCommonLoadOptions({})
  const fixedRate = normalizeCommonLoadOptions({ connections: 2, workers: 1, rate: 100 })

  assert.equal(defaults.parameters.connections, 10)
  assert.ok(defaults.parameters.workers >= 1)
  assert.ok(defaults.parameters.workers <= 4)
  assert.equal(defaults.parameters.mode, 'closed-loop')
  assert.equal(defaults.parameters.correctCoordinatedOmission, false)
  assert.equal(defaults.parameters.durationMs, 10_000)
  assert.equal(fixedRate.parameters.mode, 'fixed-rate')
  assert.equal(fixedRate.parameters.correctCoordinatedOmission, true)
})

test('shared load validators preserve topology, URL, and numeric invariants', () => {
  assert.throws(() => requireObject([], 'runLoad options'), /options must be an object/u)
  assert.throws(() => requireNonNegativeInteger(-1, 'bufferedBytes'), /non-negative safe integer/u)
  assert.throws(
    () => normalizeCommonLoadOptions({ connections: 1, workers: 2 }),
    /workers must not exceed connections/u
  )
  assert.throws(
    () =>
      normalizeLoadUrl('https://example.com', {
        operation: 'runWebSocketLoad',
        protocols: ['ws:', 'wss:'],
        absoluteKind: 'WebSocket',
        credentialsError: 'credentials are not supported'
      }),
    /must use ws: or wss:/u
  )
})
