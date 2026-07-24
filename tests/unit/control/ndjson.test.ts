import assert from 'node:assert/strict'
import test from 'node:test'
import { NdjsonDecoder, ProtocolError } from '@swarmmachina/benchkit/control'

test('NDJSON decoder handles fragmented and multiple frames', () => {
  const messages: unknown[] = []
  const errors: ProtocolError[] = []
  const decoder = new NdjsonDecoder({
    onMessage: (message) => messages.push(message),
    onError: (error) => errors.push(error)
  })

  decoder.push('{"a":')
  decoder.push('1}\n{"b":2}\n{"c"')
  decoder.push(':3}\n')
  decoder.end()

  assert.deepEqual(messages, [{ a: 1 }, { b: 2 }, { c: 3 }])
  assert.deepEqual(errors, [])
})

test('NDJSON decoder reports invalid, partial, and oversized frames', () => {
  const errors: ProtocolError[] = []
  const decoder = new NdjsonDecoder({
    maxLineBytes: 8,
    onMessage: () => assert.fail('unexpected message'),
    onError: (error) => errors.push(error)
  })

  decoder.push('123456789')
  decoder.end()

  assert.equal(errors.length, 1)
  assert.match(errors[0]?.message ?? '', /exceeds/u)

  const partialErrors: ProtocolError[] = []
  const partial = new NdjsonDecoder({
    onMessage: () => assert.fail('unexpected message'),
    onError: (error) => partialErrors.push(error)
  })

  partial.push('{"a":1')
  partial.end()
  assert.match(partialErrors[0]?.message ?? '', /partial/u)
})
