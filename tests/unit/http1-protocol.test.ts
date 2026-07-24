import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHttp1Request } from '../../dist/load/http1/request.js'
import { Http1ResponseParser } from '../../dist/load/http1/response-parser.js'

test('HTTP/1 request builder emits exact framing and an IPv6 Host header', () => {
  const request = buildHttp1Request({
    url: new URL('http://[::1]:8080/items?q=1'),
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'x-value': ['one', 'two'] },
    body: Buffer.from('body')
  }).toString('latin1')

  assert.match(request, /^POST \/items\?q=1 HTTP\/1\.1\r\n/u)
  assert.ok(request.includes('\r\nHost: [::1]:8080\r\n'))
  assert.match(request, /\r\nContent-Length: 4\r\n/u)
  assert.match(request, /\r\nConnection: keep-alive\r\n/u)
  assert.match(request, /\r\nx-value: one\r\nx-value: two\r\n/u)
  assert.match(request, /\r\n\r\nbody$/u)
})

test('HTTP/1 response parser handles byte-fragmented interim, chunked and bodyless responses', () => {
  const parser = new Http1ResponseParser({ requestMethod: 'GET', maxHeaderBytes: 4096 })
  const statuses: number[] = []
  const input = Buffer.from(
    [
      'HTTP/1.1 100 Continue\r\nx-interim: yes\r\n\r\n',
      'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n',
      '4;extension=value\r\nWiki\r\n',
      '5\r\npedia\r\n',
      '0\r\nx-trailer: complete\r\n\r\n',
      'HTTP/1.1 204 No Content\r\nDate: now\r\n\r\n'
    ].join(''),
    'latin1'
  )

  for (const byte of input) {
    parser.push(Buffer.from([byte]), (statusCode) => statuses.push(statusCode))
  }

  assert.deepEqual(statuses, [200, 204])
})

test('HTTP/1 response parser handles multiple fixed-length responses in one read', () => {
  const parser = new Http1ResponseParser({ requestMethod: 'GET', maxHeaderBytes: 4096 })
  const statuses: number[] = []

  parser.push(
    Buffer.from(
      'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok' + 'HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\n\r\n',
      'latin1'
    ),
    (statusCode) => statuses.push(statusCode)
  )

  assert.deepEqual(statuses, [200, 503])
})

test('HTTP/1 response parser handles allocation-free framing edge cases', () => {
  const parser = new Http1ResponseParser({ requestMethod: 'GET', maxHeaderBytes: 4096 })
  const statuses: number[] = []

  parser.push(
    Buffer.from(
      [
        'HTTP/1.1 204 No Content\r\n\r\n',
        'HTTP/1.1 200 OK\r\nCONTENT-LENGTH: 2, 2\r\n\r\nok',
        'HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip, CHUNKED\r\n\r\n2\r\nok\r\n0\r\n\r\n'
      ].join(''),
      'latin1'
    ),
    (statusCode) => statuses.push(statusCode)
  )

  assert.deepEqual(statuses, [204, 200, 200])
})

test('HTTP/1 response parser rejects ambiguous and close-delimited framing', () => {
  const ambiguous = new Http1ResponseParser({ requestMethod: 'GET', maxHeaderBytes: 4096 })
  const closeDelimited = new Http1ResponseParser({ requestMethod: 'GET', maxHeaderBytes: 4096 })

  assert.throws(
    () =>
      ambiguous.push(
        Buffer.from('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Length: 1\r\n\r\n0\r\n\r\n', 'latin1'),
        () => {}
      ),
    /must not contain both Transfer-Encoding and Content-Length/u
  )
  assert.throws(
    () => closeDelimited.push(Buffer.from('HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nbody', 'latin1'), () => {}),
    /close-delimited HTTP responses are not supported/u
  )
})
