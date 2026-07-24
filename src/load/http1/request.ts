import type { Http1HeaderValue } from './types.js'

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u

export interface BuildHttp1RequestOptions {
  url: URL
  method: string
  headers: Readonly<Record<string, Http1HeaderValue>>
  body: Uint8Array | undefined
}

export function buildHttp1Request({ url, method, headers, body }: BuildHttp1RequestOptions): Buffer {
  if (!TOKEN.test(method)) {
    throw new TypeError('method must be a valid HTTP token')
  }

  const path = `${url.pathname || '/'}${url.search}`

  if (containsCrLf(path)) {
    throw new TypeError('URL path must not contain CR or LF')
  }

  const normalized = new Map<string, { name: string; values: readonly string[] }>()

  for (const [name, value] of Object.entries(headers)) {
    if (!TOKEN.test(name)) {
      throw new TypeError(`invalid HTTP header name: ${name}`)
    }

    const values = Array.isArray(value) ? value : [value]

    if (values.length === 0 || values.some((entry) => typeof entry !== 'string' || containsCrLf(entry))) {
      throw new TypeError(`invalid HTTP header value: ${name}`)
    }

    normalized.set(name.toLowerCase(), { name, values })
  }

  const connection = normalized.get('connection')

  if (connection && connection.values.some((value) => value.toLowerCase() !== 'keep-alive')) {
    throw new TypeError('Connection header must be keep-alive')
  }

  if (normalized.has('transfer-encoding')) {
    throw new TypeError('request Transfer-Encoding is not supported')
  }

  const bodyBuffer = body === undefined ? null : Buffer.from(body)
  const suppliedLength = normalized.get('content-length')

  if (suppliedLength) {
    if (suppliedLength.values.length !== 1 || suppliedLength.values[0] !== String(bodyBuffer?.length ?? 0)) {
      throw new TypeError('Content-Length header does not match request body')
    }
  } else if (bodyBuffer !== null) {
    normalized.set('content-length', { name: 'Content-Length', values: [String(bodyBuffer.length)] })
  }

  if (!normalized.has('host')) {
    normalized.set('host', { name: 'Host', values: [formatHost(url)] })
  }

  if (!normalized.has('connection')) {
    normalized.set('connection', { name: 'Connection', values: ['keep-alive'] })
  }

  const lines = [`${method} ${path} HTTP/1.1`]

  for (const { name, values } of normalized.values()) {
    for (const value of values) {
      lines.push(`${name}: ${value}`)
    }
  }

  const head = Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'latin1')

  return bodyBuffer?.length ? Buffer.concat([head, bodyBuffer]) : head
}

function formatHost(url: URL): string {
  return url.host
}

function containsCrLf(value: string): boolean {
  return value.includes('\r') || value.includes('\n')
}
