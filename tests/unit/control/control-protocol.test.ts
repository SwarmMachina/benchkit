import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseRequest,
  parseResponse,
  ProtocolError,
  PROTOCOL_VERSION,
  VersionMismatchError
} from '@swarmmachina/benchkit/control'

test('control protocol validates requests and correlated responses', () => {
  assert.deepEqual(
    parseRequest({
      version: PROTOCOL_VERSION,
      id: 'request-1',
      type: 'metrics:start',
      payload: { sampleMs: 250 }
    }),
    {
      version: PROTOCOL_VERSION,
      id: 'request-1',
      type: 'metrics:start',
      payload: { sampleMs: 250 }
    }
  )

  assert.equal(
    parseResponse({
      version: PROTOCOL_VERSION,
      id: 'request-1',
      type: 'metrics:start',
      status: 'ok',
      state: 'measuring',
      payload: {}
    }).id,
    'request-1'
  )
})

test('control protocol rejects version mismatch and malformed errors', () => {
  assert.throws(
    () => parseRequest({ version: PROTOCOL_VERSION + 1, id: '1', type: 'metrics:start', payload: {} }),
    VersionMismatchError
  )
  assert.throws(
    () =>
      parseResponse({
        version: PROTOCOL_VERSION,
        id: '1',
        type: 'metrics:start',
        status: 'error'
      }),
    ProtocolError
  )
})
