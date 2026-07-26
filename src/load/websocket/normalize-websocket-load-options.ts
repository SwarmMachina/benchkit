import { normalizeCommonLoadOptions } from '../shared/normalize-common-load-options.js'
import { normalizeLoadUrl } from '../shared/load-url.js'
import {
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireObject,
  requirePositiveInteger
} from '../../validation/value-parsers.js'
import type { NormalizedWebSocketLoadOptions } from './websocket-load-context.js'
import type { RunWebSocketLoadOptions, WebSocketLoadParameters } from './types.js'

const DEFAULT_MAX_IN_FLIGHT = 1
const DEFAULT_MAX_BUFFERED_BYTES = 1024 * 1024

export function normalizeWebSocketLoadOptions(options: RunWebSocketLoadOptions): NormalizedWebSocketLoadOptions {
  requireObject(options, 'runWebSocketLoad options')

  const url = normalizeLoadUrl(options.url, {
    operation: 'runWebSocketLoad',
    protocols: ['ws:', 'wss:'],
    absoluteKind: 'WebSocket',
    credentialsError: 'WebSocket URL credentials are not supported'
  })
  const common = normalizeCommonLoadOptions(options)
  const maxInFlight = requirePositiveInteger(options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT, 'maxInFlight')
  const maxBufferedBytes = requireNonNegativeInteger(
    options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES,
    'maxBufferedBytes'
  )
  const message = normalizeMessage(options.message)
  const protocols = normalizeProtocols(options.protocols)
  const name = requireNonEmptyString(options.name ?? `WS ${url.pathname || '/'}`, 'name')
  const parameters: WebSocketLoadParameters = {
    name,
    url: url.href,
    messageType: typeof message === 'string' ? 'text' : 'binary',
    messageBytes: typeof message === 'string' ? Buffer.byteLength(message) : message.byteLength,
    protocols,
    ...common.parameters,
    maxInFlight,
    maxBufferedBytes
  }

  return {
    parameters,
    message,
    startupTimeoutMs: common.startupTimeoutMs,
    memorySampleMs: common.memorySampleMs,
    ...(common.signal === undefined ? {} : { signal: common.signal })
  }
}

function normalizeMessage(value: RunWebSocketLoadOptions['message']): string | ArrayBuffer {
  if (value === undefined) {
    return 'ping'
  }

  if (typeof value === 'string') {
    return value
  }

  if (value instanceof Uint8Array) {
    return Uint8Array.from(value).buffer
  }

  throw new TypeError('message must be a string or Uint8Array')
}

function normalizeProtocols(value: RunWebSocketLoadOptions['protocols']): string[] {
  if (value === undefined) {
    return []
  }

  const protocols = typeof value === 'string' ? [value] : Array.isArray(value) ? [...value] : null

  if (!protocols || protocols.some((protocol) => typeof protocol !== 'string' || protocol === '')) {
    throw new TypeError('protocols must be a non-empty string or an array of non-empty strings')
  }

  if (new Set(protocols).size !== protocols.length) {
    throw new TypeError('protocols must not contain duplicates')
  }

  return protocols
}
