import assert from 'node:assert/strict'
import test from 'node:test'
import { runHttp1Load } from '@swarmmachina/benchkit/load/http1'

test('runHttp1Load validates topology, URL and request framing before starting workers', async () => {
  await assert.rejects(runHttp1Load({ url: 'ftp://example.com' }), /must use http: or https:/u)
  await assert.rejects(
    runHttp1Load({ url: 'http://127.0.0.1', connections: 1, workers: 2 }),
    /workers must not exceed connections/u
  )
  await assert.rejects(
    runHttp1Load({
      url: 'http://127.0.0.1',
      headers: { 'x-test': 'valid\r\ninjected: true' }
    }),
    /invalid HTTP header value/u
  )
  await assert.rejects(
    runHttp1Load({
      url: 'http://127.0.0.1',
      headers: { 'content-length': '5' },
      body: 'shorter'
    }),
    /Content-Length header does not match request body/u
  )
  await assert.rejects(runHttp1Load({ url: 'http://127.0.0.1', rate: 0 }), /rate must be a positive/u)
  await assert.rejects(runHttp1Load({ url: 'http://127.0.0.1', correctCoordinatedOmission: true }), /requires rate/u)
  await assert.rejects(
    runHttp1Load({ url: 'http://127.0.0.1', rate: 10, correctCoordinatedOmission: 'yes' as never }),
    /must be a boolean/u
  )
})

test('runHttp1Load observes an already aborted signal before creating workers', async () => {
  const controller = new AbortController()

  controller.abort()

  await assert.rejects(runHttp1Load({ url: 'http://127.0.0.1', signal: controller.signal }), {
    name: 'AbortError'
  })
})
