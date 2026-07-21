import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import { isBaseline, validateBaseline } from '../../src/baseline.ts'

const fixtures = ['http.json', 'ws.json', 'body-parser.json']

async function readFixture(name: string) {
  return JSON.parse(await fs.readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'))
}

for (const fixture of fixtures) {
  test(`validateBaseline accepts ${fixture}`, async () => {
    const baseline = await readFixture(fixture)

    assert.deepEqual(validateBaseline(baseline), { ok: true, errors: [] })
    assert.equal(isBaseline(baseline), true)
  })
}

test('validateBaseline reports an unsupported schema', async () => {
  const baseline = await readFixture('http.json')

  baseline.schemaVersion = 'regression-ci-baseline/v2'

  assert.deepEqual(validateBaseline(baseline), {
    ok: false,
    errors: ['schemaVersion must be regression-ci-baseline/v1']
  })
})

test('validateBaseline reports missing required blocks', () => {
  assert.deepEqual(validateBaseline({ schemaVersion: 'regression-ci-baseline/v1' }), {
    ok: false,
    errors: [
      'benchmark must be an object',
      'calibration must be an object',
      'parameters must be an object',
      'metrics must be an object'
    ]
  })
})

test('validateBaseline reports invalid calibration fields and metrics', async () => {
  const baseline = await readFixture('ws.json')

  baseline.calibration.node = ''
  baseline.metrics.msgPerSec = { label: 'messages' }

  assert.deepEqual(validateBaseline(baseline), {
    ok: false,
    errors: ['calibration.node must be a non-empty string', 'metrics.msgPerSec.unit must be a string']
  })
})

test('validateBaseline never throws for an uninspectable object', () => {
  const baseline = new Proxy(
    {},
    {
      get() {
        throw new Error('uninspectable')
      }
    }
  )

  assert.deepEqual(validateBaseline(baseline), {
    ok: false,
    errors: ['baseline could not be inspected']
  })
})
