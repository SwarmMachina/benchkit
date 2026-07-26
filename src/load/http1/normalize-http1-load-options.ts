import { normalizeCommonLoadOptions } from '../shared/normalize-common-load-options.js'
import { normalizeLoadUrl } from '../shared/load-url.js'
import { requireNonEmptyString, requireObject, requirePositiveInteger } from '../../validation/value-parsers.js'
import type { NormalizedHttp1LoadOptions } from './http1-load-context.js'
import { buildHttp1Request } from './request.js'
import type { Http1LoadParameters, RunHttp1LoadOptions } from './types.js'

const DEFAULT_PIPELINING = 1
const DEFAULT_MAX_HEADER_BYTES = 64 * 1024

export function normalizeHttp1LoadOptions(options: RunHttp1LoadOptions): NormalizedHttp1LoadOptions {
  requireObject(options, 'runHttp1Load options')

  const url = normalizeLoadUrl(options.url, {
    operation: 'runHttp1Load',
    protocols: ['http:', 'https:'],
    absoluteKind: 'HTTP',
    credentialsError: 'URL credentials are not supported; use an Authorization header'
  })
  const common = normalizeCommonLoadOptions(options)
  const pipelining = requirePositiveInteger(options.pipelining ?? DEFAULT_PIPELINING, 'pipelining')
  const maxHeaderBytes = requirePositiveInteger(options.maxHeaderBytes ?? DEFAULT_MAX_HEADER_BYTES, 'maxHeaderBytes')

  if (options.method !== undefined && typeof options.method !== 'string') {
    throw new TypeError('method must be a string')
  }

  const method = (options.method ?? 'GET').toUpperCase()
  const name = requireNonEmptyString(options.name ?? `${method} ${url.pathname || '/'}`, 'name')

  if (options.socketPath !== undefined && (typeof options.socketPath !== 'string' || options.socketPath === '')) {
    throw new TypeError('socketPath must be a non-empty string')
  }

  validateTlsOptions(options.tls)

  const body = options.body === undefined ? undefined : toBody(options.body)
  const request = buildHttp1Request({
    url,
    method,
    headers: options.headers ?? {},
    body
  })
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
  const parameters: Http1LoadParameters = {
    name,
    url: url.href,
    method,
    ...common.parameters,
    pipelining
  }

  return {
    parameters,
    request,
    protocol: url.protocol as 'http:' | 'https:',
    hostname: networkHostname(url),
    port,
    ...(options.socketPath === undefined ? {} : { socketPath: options.socketPath }),
    ...(options.tls === undefined ? {} : { tls: options.tls }),
    startupTimeoutMs: common.startupTimeoutMs,
    memorySampleMs: common.memorySampleMs,
    maxHeaderBytes,
    ...(common.signal === undefined ? {} : { signal: common.signal })
  }
}

function toBody(value: string | Uint8Array): Uint8Array {
  if (typeof value === 'string') {
    return Buffer.from(value)
  }

  if (value instanceof Uint8Array) {
    return value
  }

  throw new TypeError('body must be a string or Uint8Array')
}

function networkHostname(url: URL): string {
  return url.hostname.startsWith('[') && url.hostname.endsWith(']') ? url.hostname.slice(1, -1) : url.hostname
}

function validateTlsOptions(options: RunHttp1LoadOptions['tls']): void {
  if (options === undefined) {
    return
  }

  if (!options || typeof options !== 'object') {
    throw new TypeError('tls must be an object')
  }

  if (options.rejectUnauthorized !== undefined && typeof options.rejectUnauthorized !== 'boolean') {
    throw new TypeError('tls.rejectUnauthorized must be a boolean')
  }

  if (options.servername !== undefined && (typeof options.servername !== 'string' || options.servername === '')) {
    throw new TypeError('tls.servername must be a non-empty string')
  }
}
